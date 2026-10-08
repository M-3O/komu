/**
 * One import point for stream concepts.
 *
 * Feature code should import from here rather than reaching into
 * `lib/twitch`, `lib/youtube` or `lib/kick` directly, so provider
 * specifics stay behind the shared interface
 * (IMPLEMENTATION_PLAN section 21).
 */
export { StreamingProvider } from "@prisma/client";

export {
  availableProviders,
  getStreamingProvider,
  isProviderAvailable,
  requireStreamingProvider,
} from "./registry";

export type {
  ProviderAccount,
  StreamInfo,
  StreamingProviderAdapter,
} from "./types";

export {
  connectStreamingAccount,
  disconnectStreamingAccount,
} from "./connect-account";
export type { ConnectAccountResult } from "./connect-account";

export { getLiveStatuses } from "./get-live-status";
export type { ChannelLiveStatus } from "./get-live-status";