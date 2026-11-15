import { receiveStreamWebhook } from "@/lib/streams/provider-webhooks";

export async function POST(request: Request) {
  return receiveStreamWebhook("TWITCH", request);
}
