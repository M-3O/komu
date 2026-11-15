import "server-only";

import { cache } from "react";
import { listGuildChannels, listGuildRoles } from "@/lib/discord/rest";

export const getDiscordDestinations = cache((discordId: string) => Promise.all([
  listGuildChannels(discordId).catch(() => []),
  listGuildRoles(discordId).catch(() => []),
]));
