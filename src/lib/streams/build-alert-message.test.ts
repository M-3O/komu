import { describe, expect, it } from "vitest";

import { StreamingProvider } from "@prisma/client";

import {
  applyPlaceholders,
  buildAlertMessage,
  buildEmbed,
  buildMentionContent,
  parseColor,
  type AlertSettings,
} from "./build-alert-message";
import type { StreamInfo } from "./types";

const stream: StreamInfo = {
  provider: StreamingProvider.TWITCH,
  creatorId: "98765",
  creatorUsername: "sandysanderman",
  creatorDisplayName: "SandySanderman",
  providerStreamId: "session-1",
  title: "Road to 100k",
  game: "Just Chatting",
  thumbnail: "https://cdn.example/thumb-1280x1280.jpg",
  viewerCount: 4210,
  url: "https://www.twitch.tv/sandysanderman",
  startedAt: new Date("2024-01-01T10:00:00Z"),
};

function settings(overrides: Partial<AlertSettings> = {}): AlertSettings {
  return {
    channelId: "111",
    mentionRoleId: "222",
    mentionEnabled: true,
    messageMode: "DEFAULT",
    customMessage: null,
    embedEnabled: true,
    embedColor: "#7c5cff",
    showThumbnail: true,
    showViewerCount: true,
    showGame: true,
    watchButtonEnabled: true,
    watchButtonLabel: "Watch Now",
    ...overrides,
  };
}

describe("parseColor", () => {
  it("parses a six digit hex colour", () => {
    expect(parseColor("#7c5cff")).toBe(0x7c5cff);
    expect(parseColor("7c5cff")).toBe(0x7c5cff);
  });

  it("expands a three digit hex colour", () => {
    expect(parseColor("#abc")).toBe(0xaabbcc);
  });

  it("falls back to the brand colour for nonsense", () => {
    expect(parseColor("not-a-colour")).toBe(0x7c5cff);
    expect(parseColor("")).toBe(0x7c5cff);
  });
});

describe("applyPlaceholders", () => {
  it("replaces every supported placeholder", () => {
    const result = applyPlaceholders(
      "{creator} is playing {game}: {title} ({viewers}) {url}",
      stream,
      "Sandy",
    );

    expect(result).toBe(
      "Sandy is playing Just Chatting: Road to 100k (4210) https://www.twitch.tv/sandysanderman",
    );
  });

  it("leaves unknown placeholders alone", () => {
    expect(applyPlaceholders("{nope} {title}", stream, "Sandy")).toBe(
      "{nope} Road to 100k",
    );
  });

  it("substitutes sensible text when data is missing", () => {
    const sparse = { ...stream, title: null, game: null, viewerCount: null };
    const result = applyPlaceholders("{title}|{game}|{viewers}", sparse, "Sandy");

    expect(result).toBe("a stream|just chatting|0");
  });
});

describe("buildMentionContent", () => {
  it("mentions the configured role", () => {
    expect(buildMentionContent(settings())).toBe("<@&222>");
  });

  it("says nothing when mentions are off", () => {
    expect(buildMentionContent(settings({ mentionEnabled: false }))).toBe("");
  });

  it("says nothing when no role is set", () => {
    expect(buildMentionContent(settings({ mentionRoleId: null }))).toBe("");
  });
});

describe("buildEmbed", () => {
  it("includes title, link, colour and thumbnail by default", () => {
    const embed = buildEmbed({ stream, settings: settings(), creatorName: "Sandy" });

    expect(embed.title).toBe("Sandy is live");
    expect(embed.url).toBe(stream.url);
    expect(embed.description).toBe("Road to 100k");
    expect(embed.color).toBe(0x7c5cff);
    expect(embed.image).toEqual({ url: stream.thumbnail });
  });

  it("shows game and viewers when enabled", () => {
    const embed = buildEmbed({ stream, settings: settings(), creatorName: "Sandy" });

    expect(embed.fields).toEqual([
      { name: "Playing", value: "Just Chatting", inline: true },
      { name: "Viewers", value: "4210", inline: true },
    ]);
  });

  it("hides fields the creator turned off", () => {
    const embed = buildEmbed({
      stream,
      settings: settings({ showGame: false, showViewerCount: false }),
      creatorName: "Sandy",
    });

    expect(embed.fields).toBeUndefined();
  });

  it("omits the thumbnail when the provider gave none", () => {
    const embed = buildEmbed({
      stream: { ...stream, thumbnail: null },
      settings: settings(),
      creatorName: "Sandy",
    });

    expect(embed.image).toBeUndefined();
  });

  it("uses the custom message when set", () => {
    const embed = buildEmbed({
      stream,
      settings: settings({ messageMode: "CUSTOM", customMessage: "Hey! {game}" }),
      creatorName: "Sandy",
    });

    expect(embed.description).toBe("Hey! Just Chatting");
  });

  it("marks a test alert in the footer", () => {
    const embed = buildEmbed({
      stream,
      settings: settings(),
      creatorName: "Sandy",
      isTest: true,
    });

    expect(embed.footer?.text).toBe("Komu test alert");
  });
});

describe("buildAlertMessage", () => {
  it("builds a mention, embed and watch button", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings(),
      creatorName: "Sandy",
    });

    expect(message.content).toBe("<@&222>");
    expect(message.embeds).toHaveLength(1);
    expect(message.components?.[0].components[0]).toEqual({
      type: 2,
      style: 5,
      label: "Watch Now",
      url: "https://www.twitch.tv/sandysanderman",
    });
  });

  it("uses a custom button label", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({ watchButtonLabel: "Join me" }),
      creatorName: "Sandy",
    });

    expect(message.components?.[0].components[0].label).toBe("Join me");
  });

  it("omits the button when disabled", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({ watchButtonEnabled: false }),
      creatorName: "Sandy",
    });

    expect(message.components).toBeUndefined();
  });

  it("falls back to a default label when one is blank", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({ watchButtonLabel: "   " }),
      creatorName: "Sandy",
    });

    expect(message.components?.[0].components[0].label).toBe("Watch Now");
  });

  it("refuses to build without a channel", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({ channelId: null }),
      creatorName: "Sandy",
    });

    expect(message.error).toBe("Choose a Discord channel first.");
    expect(message.embeds).toBeUndefined();
  });

  it("still shows the custom text when the embed is off", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({
        embedEnabled: false,
        messageMode: "CUSTOM",
        customMessage: "Go watch {title}",
      }),
      creatorName: "Sandy",
    });

    expect(message.embeds).toBeUndefined();
    expect(message.content).toContain("<@&222>");
    expect(message.content).toContain("Go watch Road to 100k");
  });

  it("produces a usable message with everything disabled", () => {
    const message = buildAlertMessage({
      stream,
      settings: settings({
        embedEnabled: false,
        mentionEnabled: false,
        watchButtonEnabled: false,
        messageMode: "DEFAULT",
      }),
      creatorName: "Sandy",
    });

    expect(message.error).toBeUndefined();
    expect(message.content).toBeUndefined();
    expect(message.embeds).toBeUndefined();
    expect(message.components).toBeUndefined();
  });
});