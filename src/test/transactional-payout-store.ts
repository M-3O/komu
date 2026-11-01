/**
 * Offline READ COMMITTED model for payout tests. This is not a PostgreSQL
 * substitute: the separate integration suite validates the engine semantics.
 *
 * Transactions overlap. Only explicitly locked rows wait, reads after waiting
 * see committed data, writes are private until commit, and rollback discards
 * only the failing transaction's writes. A callback-only $transaction mock or
 * a global mutex would conceal the races these tests are meant to catch.
 */
type Member = {
  id: string;
  guildId: string;
  discordId: string;
  xp: number;
  level: number;
  xpToday: number;
  xpTodayResetAt: Date | null;
};

type Progress = {
  id: string;
  guildId: string;
  memberId: string;
  challengeId: string;
  completedAt: Date | null;
  rewardGivenAt: Date | null;
};

type Challenge = {
  name: string;
  xpReward: number;
  rewardRoleId: string | null;
  rewardRoleName: string | null;
};

type Detail = { totalXp: number; level: number; xpToNextLevel: number };
type LedgerEntry = { memberId: string; amount: number; source: string; reason?: string };
type ProgressWhere = {
  id?: string;
  guildId: string;
  memberId: string;
  challengeId?: string;
  completedAt: { not: null };
  rewardGivenAt: null;
};

export type PayoutFailure = "ledger" | "member" | "detail" | "marker" | "marker-count" | "commit" | "commit-unknown";

export function rendezvous(participants: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  return async () => {
    arrived += 1;
    if (arrived === participants) release();
    await ready;
  };
}

export class TransactionalPayoutStore {
  members = new Map<string, Member>();
  progress = new Map<string, Progress>();
  challenges = new Map<string, Challenge>();
  details = new Map<string, Detail>();
  ledger: LedgerEntry[] = [];
  failAt: PayoutFailure | undefined;
  beforeCandidates: (() => Promise<void>) | undefined;
  beforeLedgerWrite: (() => Promise<void>) | undefined;
  missingXpMember = false;
  dailyCap = 1;
  transactionsStarted = 0;
  activeTransactions = 0;
  lockWaits = 0;
  attemptedLedgerWrites = 0;
  attemptedMemberWrites = 0;
  attemptedDetailWrites = 0;
  private tails = new Map<string, Promise<void>>();

  constructor() {
    this.seed();
  }

  seed(suffix = "1", memberId = `member-${suffix}`) {
    if (!this.members.has(memberId)) {
      this.members.set(memberId, {
        id: memberId, guildId: "guild-1", discordId: `discord-${memberId}`,
        xp: 0, level: 1, xpToday: 0, xpTodayResetAt: null,
      });
    }
    this.challenges.set(`challenge-${suffix}`, {
      name: `Challenge ${suffix}`, xpReward: 250,
      rewardRoleId: "role-1", rewardRoleName: "Winner",
    });
    this.progress.set(`progress-${suffix}`, {
      id: `progress-${suffix}`, guildId: "guild-1", memberId,
      challengeId: `challenge-${suffix}`, completedAt: new Date(), rewardGivenAt: null,
    });
  }

  private matches(row: Progress, where: ProgressWhere): boolean {
    return (!where.id || row.id === where.id) && row.guildId === where.guildId &&
      row.memberId === where.memberId && (!where.challengeId || row.challengeId === where.challengeId) &&
      row.completedAt !== null && row.rewardGivenAt === null;
  }

  private fail(point: PayoutFailure): void {
    if (this.failAt === point) {
      this.failAt = undefined;
      throw new Error(`Injected ${point} failure`);
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key);
    if (previous) this.lockWaits += 1;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, held);
    await previous;
    return () => {
      if (this.tails.get(key) === held) this.tails.delete(key);
      release();
    };
  }

  api = {
    guildMember: {
      findFirst: async ({ where }: { where: { guildId: string; discordId: string } }) => {
        return [...this.members.values()].find((m) => m.guildId === where.guildId && m.discordId === where.discordId) ?? null;
      },
    },
    challengeProgress: {
      findMany: async ({ where }: { where: ProgressWhere }) => {
        // Capture both candidates before either transaction wins, when the
        // test installs a rendezvous here. Candidate reads never take a lock.
        const rows = [...this.progress.values()].filter((p) => this.matches(p, where)).map((p) => ({
          ...p, challenge: { ...this.challenges.get(p.challengeId)! },
        }));
        await this.beforeCandidates?.();
        return rows;
      },
    },
    $transaction: async <T>(operation: (tx: ReturnType<TransactionalPayoutStore["transactionClient"]>) => Promise<T>) => {
      this.transactionsStarted += 1;
      this.activeTransactions += 1;
      const locks = new Map<string, () => void>();
      const memberWrites = new Map<string, Member>();
      const progressWrites = new Map<string, Progress>();
      const detailWrites = new Map<string, Detail>();
      const ledgerWrites: LedgerEntry[] = [];
      try {
        const tx = this.transactionClient(locks, memberWrites, progressWrites, detailWrites, ledgerWrites);
        const result = await operation(tx);
        this.fail("commit");
        for (const [id, value] of memberWrites) this.members.set(id, value);
        for (const [id, value] of progressWrites) this.progress.set(id, value);
        for (const [id, value] of detailWrites) this.details.set(id, value);
        this.ledger.push(...ledgerWrites);
        // A lost COMMIT acknowledgement leaves a durable marker. A later
        // call must still skip the payout rather than assuming rollback.
        this.fail("commit-unknown");
        return result;
      } finally {
        this.activeTransactions -= 1;
        for (const release of [...locks.values()].reverse()) release();
      }
    },
  };

  private transactionClient(
    locks: Map<string, () => void>,
    memberWrites: Map<string, Member>,
    progressWrites: Map<string, Progress>,
    detailWrites: Map<string, Detail>,
    ledgerWrites: LedgerEntry[],
  ) {
    const lock = async (key: string) => {
      if (!locks.has(key)) locks.set(key, await this.acquire(key));
    };
    const requireLock = (key: string) => {
      if (!locks.has(key)) throw new Error("Write attempted without its row lock");
    };
    return {
      $queryRaw: async (sql: TemplateStringsArray, ...values: string[]) => {
        const text = sql.join("?");
        if (!/FOR UPDATE/i.test(text)) throw new Error("Expected an explicit row lock");
        const [id, guildId, memberId] = values;
        if (text.includes("challenge_progress")) {
          await lock(`progress:${id}`);
          const row = progressWrites.get(id) ?? this.progress.get(id);
          return row && this.matches(row, { id, guildId, memberId, completedAt: { not: null }, rewardGivenAt: null }) ? [{ id }] : [];
        }
        if (text.includes("guild_members")) {
          await lock(`member:${id}`);
          return this.members.has(id) ? [{ id }] : [];
        }
        throw new Error("Unexpected raw query");
      },
      guildMember: {
        findUnique: async ({ where }: { where: { id: string } }) => this.missingXpMember ? null : memberWrites.get(where.id) ?? this.members.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Partial<Member> }) => {
          requireLock(`member:${where.id}`);
          this.attemptedMemberWrites += 1;
          this.fail("member");
          const member = memberWrites.get(where.id) ?? this.members.get(where.id)!;
          memberWrites.set(where.id, { ...member, ...data });
        },
      },
      guild: { findUnique: async () => ({ xpDailyCap: this.dailyCap }) },
      xPTransaction: {
        create: async ({ data }: { data: LedgerEntry }) => {
          requireLock(`member:${data.memberId}`);
          await this.beforeLedgerWrite?.();
          this.attemptedLedgerWrites += 1;
          this.fail("ledger");
          ledgerWrites.push({ ...data });
        },
      },
      memberXP: {
        upsert: async ({ where, create, update }: { where: { memberId: string }; create: Detail; update: Detail }) => {
          requireLock(`member:${where.memberId}`);
          this.attemptedDetailWrites += 1;
          this.fail("detail");
          detailWrites.set(where.memberId, { ...(this.details.has(where.memberId) ? update : create) });
        },
      },
      challengeProgress: {
        updateMany: async ({ where, data }: { where: ProgressWhere; data: { rewardGivenAt: Date } }) => {
          requireLock(`progress:${where.id}`);
          this.fail("marker");
          if (this.failAt === "marker-count") {
            this.failAt = undefined;
            return { count: 0 };
          }
          const row = progressWrites.get(where.id!) ?? this.progress.get(where.id!);
          if (!row || !this.matches(row, where)) return { count: 0 };
          progressWrites.set(row.id, { ...row, ...data });
          return { count: 1 };
        },
      },
    };
  }
}
