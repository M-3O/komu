import { describe, expect, it } from "vitest";

import { isGuildAdmin } from "../permissions";
import { COMMANDS, getAutocompleteHandler, getHandler } from "./index";

/**
 * Guards the command registry.
 *
 * These shapes go straight to Discord, so a malformed builder fails at
 * registration time rather than in a user's server.
 */
describe("command registry", () => {
  it("has unique command names", () => {
    const names = COMMANDS.map((command) => command.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every command a handler", () => {
    for (const command of COMMANDS) {
      expect(typeof command.handle).toBe("function");
    }
  });

  it("serialises every command to valid Discord JSON", () => {
    for (const command of COMMANDS) {
      const json = command.definition.toJSON();

      expect(json.name).toBe(command.definition.name);
      expect(json.name).toMatch(/^[-_\p{L}\p{N}]{1,32}$/u);
      expect(typeof json.description).toBe("string");
      expect(json.description.length).toBeGreaterThan(0);
      // Discord rejects descriptions longer than 100 characters.
      expect(json.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("resolves handlers by name", () => {
    expect(getHandler("help")).toBeTypeOf("function");
    expect(getHandler("setup")).toBeTypeOf("function");
    expect(getHandler("ping")).toBeTypeOf("function");
    expect(getHandler("reward")).toBeTypeOf("function");
  });

  it("returns undefined for an unknown command", () => {
    expect(getHandler("definitely-not-a-command")).toBeUndefined();
  });

  it("gives autocomplete handlers only to commands that use them", () => {
    for (const command of COMMANDS) {
      if (!command.autocomplete) continue;

      // A command whose options use autocomplete must have a handler, or
      // Discord shows no suggestions and nothing explains why.
      const json = command.definition.toJSON();
      const usesAutocomplete = JSON.stringify(json).includes('"autocomplete":true');

      expect(usesAutocomplete).toBe(true);
      expect(getAutocompleteHandler(command.definition.name)).toBe(command.autocomplete);
    }
  });

  it("has an autocomplete handler for /reward", () => {
    expect(getAutocompleteHandler("reward")).toBeTypeOf("function");
  });
});

describe("isGuildAdmin", () => {
  it("treats a missing permission object as not-admin", () => {
    const fake = { memberPermissions: null } as never;
    expect(isGuildAdmin(fake)).toBe(false);
  });

  it("reads Administrator from the caller's permissions", () => {
    const admin = { has: () => true } as never;
    const nonAdmin = { has: () => false } as never;

    expect(isGuildAdmin({ memberPermissions: admin } as never)).toBe(true);
    expect(isGuildAdmin({ memberPermissions: nonAdmin } as never)).toBe(false);
  });
});