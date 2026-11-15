import "server-only";

import { createHmac, timingSafeEqual, verify } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchWithTimeout } from "@/lib/http/fetch-with-timeout";
import { getAppAccessToken } from "@/lib/twitch/client";
import { getAccessToken } from "@/lib/kick/client";
import { buildChannelUrl as kickUrl } from "@/lib/kick/normalize";
import { buildChannelUrl as twitchUrl } from "@/lib/twitch/normalize";
import { recordStreamObservation, sendLiveAlert } from "./alert-delivery";

type Provider = "TWITCH" | "KICK";
const MAX_AGE = 10 * 60_000;
const MAX_BODY = 64 * 1024;
let kickKey: { pem: string; expires: number } | undefined;

function callback(provider: Provider) {
  const configured = process.env.STREAM_WEBHOOK_BASE_URL;
  const enabled = provider === "TWITCH" ? process.env.KOMU_TWITCH_WEBHOOK_ENABLED : process.env.KOMU_KICK_WEBHOOK_ENABLED;
  if (enabled !== "true" || !configured || (provider === "TWITCH" && !process.env.TWITCH_EVENTSUB_SECRET)) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    url.pathname !== "/" || url.search || url.hash) {
    throw new Error("STREAM_WEBHOOK_BASE_URL must be an HTTPS origin.");
  }
  return new URL(`/api/webhooks/streams/${provider.toLowerCase()}`, url).href;
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return Buffer.concat(chunks);
    size += chunk.value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
}

async function getKickKey(refresh = false) {
  if (!refresh && kickKey && kickKey.expires > Date.now()) return kickKey.pem;
  const response = await fetchWithTimeout("https://api.kick.com/public/v1/public-key", { cache: "no-store" });
  if (!response.ok) throw new Error("Kick signing key unavailable");
  const body = await response.json() as { data?: { public_key?: string } };
  if (!body.data?.public_key) throw new Error("Kick signing key unavailable");
  kickKey = { pem: body.data.public_key, expires: Date.now() + 60 * 60_000 };
  return kickKey.pem;
}

function timestamp(value?: string | null) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export async function receiveStreamWebhook(provider: Provider, request: Request) {
  if (!callback(provider)) return new Response(null, { status: 503 });
  const twitch = provider === "TWITCH";
  const prefix = twitch ? "Twitch-Eventsub-Message" : "Kick-Event-Message";
  const id = request.headers.get(`${prefix}-Id`);
  const rawTime = request.headers.get(`${prefix}-Timestamp`);
  const received = timestamp(rawTime);
  const signature = request.headers.get(twitch ? "Twitch-Eventsub-Message-Signature" : "Kick-Event-Signature");
  if (!id || id.length > 128 || !received || !signature || Math.abs(Date.now() - +received) > MAX_AGE) {
    return new Response(null, { status: 403 });
  }
  const body = await readBody(request);
  if (!body) return new Response(null, { status: 413 });
  let valid: boolean;
  if (twitch) {
    const expected = createHmac("sha256", process.env.TWITCH_EVENTSUB_SECRET!)
      .update(id + rawTime).update(body).digest("hex");
    const actual = Buffer.from(signature);
    const signed = Buffer.from(`sha256=${expected}`);
    valid = actual.length === signed.length && timingSafeEqual(actual, signed);
  } else {
    const signed = Buffer.concat([Buffer.from(`${id}.${rawTime}.`), body]);
    const bytes = Buffer.from(signature, "base64");
    try {
      valid = verify("RSA-SHA256", signed, await getKickKey(), bytes);
      if (!valid && kickKey && kickKey.expires - Date.now() < 59 * 60_000) {
        valid = verify("RSA-SHA256", signed, await getKickKey(true), bytes);
      }
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  if (!valid) return new Response(null, { status: 403 });
  try {
    const payload = JSON.parse(body.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return new Response(null, { status: 400 });
    const type = request.headers.get("Twitch-Eventsub-Message-Type");
    if (twitch && type === "webhook_callback_verification" && typeof payload.challenge === "string") {
      return new Response(payload.challenge);
    }
    if (twitch && type === "revocation") {
      await saveHealth(provider, false, new Date(0));
      return new Response(null, { status: 204 });
    }
    let data: Prisma.StreamWebhookEventCreateManyInput;
    if (twitch) {
      if (type !== "notification" || !["stream.online", "stream.offline"].includes(payload.subscription?.type)) {
        return new Response(null, { status: 400 });
      }
      const event = payload.event;
      const online = payload.subscription.type === "stream.online";
      const startedAt = online ? timestamp(event?.started_at) : null;
      if (!event || !/^\d+$/.test(event.broadcaster_user_id) ||
        (online && (!startedAt || +startedAt > +received + 60_000 ||
          typeof event.id !== "string" || !event.id))) return new Response(null, { status: 400 });
      data = { provider, eventId: id, broadcasterId: event.broadcaster_user_id,
        observedAt: startedAt ?? received, startedAt, streamKey: online ? event.id : null };
    } else {
      const startedAt = timestamp(payload.started_at);
      const endedAt = timestamp(payload.ended_at);
      const broadcasterId = String(payload.broadcaster?.user_id);
      if (request.headers.get("Kick-Event-Type") !== "livestream.status.updated" ||
        !/^\d+$/.test(broadcasterId) || !startedAt || typeof payload.is_live !== "boolean" ||
        +startedAt > +received + 60_000 ||
        (!payload.is_live && (!endedAt || +endedAt < +startedAt || +endedAt > +received + 60_000))) {
        return new Response(null, { status: 400 });
      }
      data = { provider, eventId: id, broadcasterId, observedAt: endedAt ?? startedAt,
        startedAt: payload.is_live ? startedAt : null, streamKey: startedAt.toISOString(),
        title: typeof payload.title === "string" ? payload.title.slice(0, 500) : null };
    }
    const connected = await prisma.streamingAccount.findFirst({
      where: { provider, providerUserId: data.broadcasterId, disconnectedAt: null }, select: { id: true },
    });
    if (connected) await prisma.streamWebhookEvent.createMany({ data, skipDuplicates: true });
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(null, { status: error instanceof SyntaxError ? 400 : 503 });
  }
}

export async function processStreamWebhookEvents() {
  const events = await prisma.streamWebhookEvent.findMany({
    where: { processedAt: null }, orderBy: { receivedAt: "asc" }, take: 100,
  });
  for (const event of events) {
    try {
      if (callback(event.provider === "TWITCH" ? "TWITCH" : "KICK")) await processWebhookEvent(event);
      await prisma.streamWebhookEvent.update({
        where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
        data: { processedAt: new Date() },
      });
    } catch {
      // Keep a failed event available without blocking the rest of the queue.
    }
  }
}

async function processWebhookEvent(event: Prisma.StreamWebhookEventGetPayload<object>) {
  const accounts = await prisma.streamingAccount.findMany({
    where: { provider: event.provider, providerUserId: event.broadcasterId, disconnectedAt: null },
    include: { alertConfig: true },
  });
  for (const account of accounts) {
    if (!event.startedAt || !event.streamKey) {
      if (event.provider === "TWITCH") {
        // Twitch offline events have no session ID. Confirm the channel is
        // offline before using the event timestamp to close its session.
        const { observeLiveStream } = await import("./poller");
        if (await observeLiveStream(account)) continue;
      }
      await recordStreamObservation(account.id, null, event.observedAt, event.streamKey ?? undefined);
      continue;
    }
    const stream = {
      provider: account.provider, providerStreamId: event.streamKey,
      creatorId: account.providerUserId, creatorUsername: account.username,
      creatorDisplayName: account.displayName, startedAt: event.startedAt,
      title: event.title, game: null, thumbnail: null, viewerCount: null,
      url: (account.provider === "KICK" ? kickUrl : twitchUrl)(account.username),
    };
    const knownEnd = await prisma.streamWebhookEvent.findFirst({
      where: { provider: event.provider, broadcasterId: event.broadcasterId, startedAt: null,
        observedAt: { gte: event.observedAt },
        ...(event.provider === "KICK" ? { streamKey: event.streamKey } : {}) },
      select: { observedAt: true },
    });
    if (knownEnd) {
      await recordStreamObservation(account.id, null, knownEnd.observedAt, event.streamKey);
      continue;
    }
    const streamId = await recordStreamObservation(account.id, stream, event.observedAt);
    if (streamId && Date.now() - +event.observedAt < 60_000) {
      await sendLiveAlert(account.id, streamId, stream);
    }
  }
}

async function saveHealth(provider: Provider, ready: boolean, checkedAt = new Date()) {
  const data = { checkedAt, ready };
  await prisma.streamWebhookHealth.upsert({ where: { provider }, create: { provider, ...data }, update: data });
}

async function syncSubscriptions(provider: Provider, url: string) {
  const accounts = await prisma.streamingAccount.findMany({
    where: { provider, disconnectedAt: null }, select: { providerUserId: true },
  });
  const ids = new Set(accounts.map((account) => account.providerUserId));
  const twitch = provider === "TWITCH";
  const endpoint = twitch ? "https://api.twitch.tv/helix/eventsub/subscriptions"
    : "https://api.kick.com/public/v1/events/subscriptions";
  const token = await (twitch ? getAppAccessToken() : getAccessToken());
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
    ...(twitch ? { "Client-Id": process.env.TWITCH_CLIENT_ID ?? "" } : {}) };
  type Subscription = { id: string; type?: string; event?: string; status?: string;
    broadcaster_user_id?: number; condition?: { broadcaster_user_id: string }; transport?: { callback?: string } };
  const subscriptions: Subscription[] = [];
  let cursor: string | undefined;
  do {
    const result = await fetchWithTimeout(endpoint + (cursor ? `?after=${encodeURIComponent(cursor)}` : ""), { headers });
    if (!result.ok) return false;
    const payload = await result.json() as { data: Subscription[]; pagination?: { cursor?: string } };
    subscriptions.push(...payload.data);
    cursor = twitch ? payload.pagination?.cursor : undefined;
  } while (cursor);
  const names = twitch ? ["stream.online", "stream.offline"] : ["livestream.status.updated"];
  const active = new Set<string>();
  let ready = true;
  for (const sub of subscriptions) {
    const name = twitch ? sub.type : sub.event;
    if (!name || !names.includes(name) || (twitch && sub.transport?.callback !== url)) continue;
    const id = twitch ? sub.condition?.broadcaster_user_id : String(sub.broadcaster_user_id);
    if (id && ids.has(id) && (!twitch || ["enabled", "webhook_callback_verification_pending"].includes(sub.status ?? ""))) {
      active.add(`${id}:${name}`);
      if (twitch && sub.status !== "enabled") ready = false;
      continue;
    }
    const deleted = await fetchWithTimeout(`${endpoint}?id=${encodeURIComponent(sub.id)}`, { method: "DELETE", headers });
    if (!deleted.ok && deleted.status !== 404) ready = false;
  }
  for (const id of ids) {
    for (const name of names) {
      if (active.has(`${id}:${name}`)) continue;
      const payload = twitch ? {
        type: name, version: "1", condition: { broadcaster_user_id: id },
        transport: { method: "webhook", callback: url, secret: process.env.TWITCH_EVENTSUB_SECRET },
      } : { broadcaster_user_id: Number(id), events: [{ name, version: 1 }], method: "webhook" };
      const added = await fetchWithTimeout(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      if (twitch || !added.ok) ready = false;
      if (!twitch && added.ok) {
        const response = await added.json() as { data?: Array<{ subscription_id?: string }> };
        if (!response.data?.[0]?.subscription_id) ready = false;
      }
    }
  }
  return ready;
}

export async function reconcileStreamWebhookSubscriptions() {
  for (const provider of ["TWITCH", "KICK"] as const) {
    await syncProviderWhenDue(provider);
  }
  await prisma.streamWebhookEvent.deleteMany({
    where: { processedAt: { not: null }, receivedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } },
  });
}

async function syncProviderWhenDue(provider: Provider) {
  let ready = false;
  try {
    const url = callback(provider);
    if (!url) return;
    const now = new Date();
    const reserved = await prisma.$queryRaw<Array<{ provider: Provider }>>`
      INSERT INTO stream_webhook_health (provider, "checkedAt", ready)
      VALUES (${provider}::"StreamingProvider", ${now}, false)
      ON CONFLICT (provider) DO UPDATE SET "checkedAt" = EXCLUDED."checkedAt"
      WHERE stream_webhook_health."checkedAt" < ${new Date(+now - 14 * 60_000)}
      RETURNING provider
    `;
    if (!reserved.length) return;
    ready = await syncSubscriptions(provider, url);
  } catch {
    // Keep polling and publish degraded health.
  }
  await saveHealth(provider, ready);
}
