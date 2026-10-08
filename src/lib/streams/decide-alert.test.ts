import { describe, expect, it } from "vitest";

import { StreamingProvider } from "@prisma/client";

import { decideAlertAction, type KnownSession } from "./decide-alert";
import type { StreamInfo } from "./types";

/**
 * The rule that matters most in this feature: one alert per live session.
 */

const online: StreamInfo = {
  provider: StreamingProvider.TWITCH,
  creatorId: "98765",
  creatorUsername: "sandysanderman",
  creatorDisplayName: "SandySanderman",
  providerStreamId: "session-1",
  title: "Playing something",
  game: "Little Nightmares",
  thumbnail: null,
  viewerCount: 100,
  url: "https://www.twitch.tv/sandysanderman",
  startedAt: new Date("2024-01-01T10:00:00Z"),
};

const now = new Date();

function known(overrides: Partial<KnownSession> = {}): KnownSession {
  return {
    providerStreamId: "session-1",
    alertSentAt: now,
    endedAt: null,
    ...overrides,
  };
}

describe("decideAlertAction", () => {
  it("alerts the first time a creator is seen live", () => {
    const decision = decideAlertAction(online, null);

    expect(decision.action).toBe("ALERT");
    if (decision.action === "ALERT") {
      expect(decision.stream.providerStreamId).toBe("session-1");
    }
  });

  it("never alerts twice for the same session", () => {
    // Same session, already announced.
    const decision = decideAlertAction(online, known());

    expect(decision.action).toBe("SKIP_ALREADY_ALERTED");
  });

  it("stays quiet across repeated polls of one session", () => {
    // Several passes in a row seeing the same live stream must not alert
    // more than once.
    for (let pass = 0; pass < 5; pass++) {
      expect(decideAlertAction(online, known()).action).toBe(
        "SKIP_ALREADY_ALERTED",
      );
    }
  });

  it("alerts again when the creator starts a new session", () => {
    // Previous session was announced, but Twitch issued a new stream id.
    const next = { ...online, providerStreamId: "session-2" };
    const decision = decideAlertAction(next, known());

    expect(decision.action).toBe("ALERT");
  });

  it("closes an open session when the creator goes offline", () => {
    const decision = decideAlertAction(null, known({ endedAt: null }));

    expect(decision.action).toBe("CLOSE_SESSION");
    if (decision.action === "CLOSE_SESSION") {
      expect(decision.providerStreamId).toBe("session-1");
    }
  });

  it("does nothing when offline with nothing open", () => {
    expect(decideAlertAction(null, null).action).toBe("CLOSE_SESSION");

    const decision = decideAlertAction(null, known({ endedAt: now }));
    expect(decision.action).toBe("CLOSE_SESSION");
    if (decision.action === "CLOSE_SESSION") {
      expect(decision.providerStreamId).toBeNull();
    }
  });

  it("alerts when a recorded session was never announced", () => {
    // Recorded but the alert failed, so it should be retried.
    const decision = decideAlertAction(
      online,
      known({ alertSentAt: null }),
    );

    expect(decision.action).toBe("ALERT");
  });

  it("still does not re-alert a session id that was already announced", () => {
    // Providers issue a new stream id per session, so a session id that was
    // already announced stays announced even after it ended. Preferring a
    // missed alert over a duplicate one is the safer failure, and "sent only
    // once for the same live session" is the stated requirement.
    const decision = decideAlertAction(online, known({ endedAt: now }));

    expect(decision.action).toBe("SKIP_ALREADY_ALERTED");
  });

  it("handles a creator who has never streamed", () => {
    expect(decideAlertAction(null, null).action).toBe("CLOSE_SESSION");
  });
});