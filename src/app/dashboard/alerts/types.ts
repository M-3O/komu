export interface ChannelOption {
  id: string;
  label: string;
}

export interface AlertDefaults {
  enabled: boolean;
  channelId: string;
  mentionRoleId: string;
  mentionEnabled: boolean;
  messageMode: string;
  customMessage: string;
  embedEnabled: boolean;
  embedColor: string;
  showThumbnail: boolean;
  showViewerCount: boolean;
  showGame: boolean;
  watchButtonEnabled: boolean;
  watchButtonLabel: string;
}

export interface AlertAccount {
  id: string;
  provider: string;
  username: string;
  displayName: string | null;
  defaults: AlertDefaults;
}
