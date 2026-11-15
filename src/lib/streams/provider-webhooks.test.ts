import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  streamingAccount: { findFirst: vi.fn() },
  streamWebhookEvent: { createMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("./alert-delivery", () => ({}));

import { receiveStreamWebhook } from "./provider-webhooks";

const secret = "only-for-webhook-unit-tests";
const body = JSON.stringify({
  subscription: { type: "stream.online" },
  event: { id: "stream-123", broadcaster_user_id: "123", started_at: new Date().toISOString() },
});

function twitchRequest(id: string, timestamp: string, payload: string, signatureBody = payload, type = "notification") {
  const signature = createHmac("sha256", secret).update(id + timestamp + signatureBody).digest("hex");
  return new Request("https://komu.test/api/webhooks/streams/twitch", {
    method: "POST", body: payload, headers: {
      "Twitch-Eventsub-Message-Id": id,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Type": type,
      "Twitch-Eventsub-Message-Signature": "sha256=" + signature,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STREAM_WEBHOOK_BASE_URL", "https://komu.test");
  vi.stubEnv("KOMU_TWITCH_WEBHOOK_ENABLED", "true");
  vi.stubEnv("KOMU_KICK_WEBHOOK_ENABLED", "true");
  vi.stubEnv("TWITCH_EVENTSUB_SECRET", secret);
  db.streamingAccount.findFirst.mockResolvedValue({ id: "account" });
  db.streamWebhookEvent.createMany.mockResolvedValue({ count: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("queues signed Twitch notifications with a durable dedup key", async () => {
  const timestamp = new Date().toISOString();
  for (let i = 0; i < 2; i++) {
    const response = await receiveStreamWebhook("TWITCH", twitchRequest("event-123", timestamp, body));
    expect(response.status).toBe(204);
  }
  expect(db.streamWebhookEvent.createMany).toHaveBeenCalledWith({
    data: expect.objectContaining({ provider: "TWITCH", eventId: "event-123", streamKey: "stream-123" }),
    skipDuplicates: true,
  });
});

it("rejects a bad signature or old delivery before touching Postgres", async () => {
  expect((await receiveStreamWebhook("TWITCH", twitchRequest("bad", new Date().toISOString(), body, "changed"))).status).toBe(403);
  expect((await receiveStreamWebhook("TWITCH", twitchRequest("old", new Date(0).toISOString(), body))).status).toBe(403);
  expect(db.streamWebhookEvent.createMany).not.toHaveBeenCalled();
});

it("responds to the signed Twitch verification challenge", async () => {
  const payload = JSON.stringify({ challenge: "signed-challenge" });
  const response = await receiveStreamWebhook("TWITCH",
    twitchRequest("challenge", new Date().toISOString(), payload, payload, "webhook_callback_verification"));
  expect(await response.text()).toBe("signed-challenge");
});

it("verifies Kick signatures and normalizes a broadcast start to its polling key", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
    data: { public_key: publicKey.export({ type: "spki", format: "pem" }) },
  })));
  const now = new Date().toISOString();
  const id = "kick-123";
  const payload = JSON.stringify({
    broadcaster: { user_id: 123 }, is_live: true, started_at: now, ended_at: null,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${id}.${now}.${payload}`), privateKey).toString("base64");
  const request = new Request("https://komu.test/api/webhooks/streams/kick", {
    method: "POST", body: payload, headers: {
      "Kick-Event-Message-Id": id, "Kick-Event-Message-Timestamp": now,
      "Kick-Event-Type": "livestream.status.updated", "Kick-Event-Signature": signature,
    },
  });
  expect((await receiveStreamWebhook("KICK", request)).status).toBe(204);
  expect(db.streamWebhookEvent.createMany).toHaveBeenCalledWith({
    data: expect.objectContaining({ provider: "KICK", eventId: id, streamKey: now }), skipDuplicates: true,
  });
});
