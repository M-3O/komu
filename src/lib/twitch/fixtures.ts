/**
 * Realistic Twitch payloads, copied from the Helix documentation examples.
 *
 * Used by the integration check in `integration.test.ts` so the normaliser
 * is exercised against the shapes Twitch actually sends, including the
 * awkward parts: thumbnail placeholders, empty strings for unset values, and
 * an empty `data` array for an offline channel.
 */

export const LIVE_STREAM_RESPONSE = {
  data: [
    {
      id: "123456789",
      user_id: "98765",
      user_login: "sandysanderman",
      user_name: "SandySanderman",
      game_id: "494131",
      game_name: "Little Nightmares",
      type: "live",
      title: "hablamos y le damos a Little Nightmares 1",
      tags: ["Español"],
      viewer_count: 78365,
      started_at: "2021-03-10T15:04:21Z",
      language: "es",
      thumbnail_url:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_auronplay-{width}x{height}.jpg",
      tag_ids: [],
      is_mature: false,
    },
  ],
  pagination: {
    cursor: "eyJiIjp7IkN1cnNvciI6ImV5SnpJam8zT0RNMk5TNDBORFF4TlRjMU1UY3hOU3dpWkNJNlptRnNjMlVzSW5RaU9uUnlkV1Y5In0sImEiOnsiQ3Vyc29yIjoiZXlrb3hOVGs0TkM0MU56RXhNekExTVRZNU1ESXNJbVFpT21aaGJITmxMQ0owSWpwMGNuVmxmUT09In19",
  },
};

/** Twitch omits offline channels entirely rather than returning type "". */
export const OFFLINE_STREAM_RESPONSE = {
  data: [],
  pagination: {},
};

/** A channel with no category and no title set. */
export const MINIMAL_STREAM_RESPONSE = {
  data: [
    {
      id: "555000111",
      user_id: "98765",
      user_login: "quietchannel",
      user_name: "QuietChannel",
      game_id: "",
      game_name: "",
      type: "live",
      title: "",
      tags: [],
      viewer_count: 0,
      started_at: "2024-01-15T09:30:00Z",
      language: "en",
      thumbnail_url:
        "https://static-cdn.jtvnw.net/previews-ttv/live_user_quietchannel-{width}x{height}.jpg",
      tag_ids: [],
      is_mature: false,
    },
  ],
  pagination: {},
};

export const USER_RESPONSE = {
  data: [
    {
      id: "98765",
      login: "sandysanderman",
      display_name: "SandySanderman",
      type: "",
      broadcaster_type: "partner",
      description: "",
      profile_image_url:
        "https://static-cdn.jtvnw.net/jtv_user_pictures/sandysanderman-profile.png",
      offline_image_url: "",
      view_count: 191326,
      email: "",
    },
  ],
  pagination: {},
};

/** A user with no profile image and no display name set. */
export const USER_WITHOUT_IMAGE_RESPONSE = {
  data: [
    {
      id: "98765",
      login: "quietchannel",
      display_name: "",
      type: "",
      broadcaster_type: "",
      description: "",
      profile_image_url: "",
      offline_image_url: "",
    },
  ],
  pagination: {},
};