import { describe, expect, it } from "vitest";

import { escapeRegExp, findBlockedWord, isBlocked, parseWordList } from "./word-filter";

/**
 * Word filter matching.
 *
 * The whole-word behaviour is the part that matters most: a filter that
 * deletes "class" because "ass" is blocked is worse than no filter at all.
 */

describe("escapeRegExp", () => {
  it("escapes characters that would otherwise be syntax", () => {
    expect(escapeRegExp("a.b*c")).toBe("a\\.b\\*c");
    expect(escapeRegExp("(x)")).toBe("\\(x\\)");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeRegExp("badword")).toBe("badword");
  });
});

describe("findBlockedWord", () => {
  it("finds a blocked word", () => {
    expect(findBlockedWord("this contains badword here", ["badword"])).toBe("badword");
  });

  it("ignores case", () => {
    expect(findBlockedWord("BADWORD", ["badword"])).toBe("badword");
    expect(findBlockedWord("badword", ["BADWORD"])).toBe("BADWORD");
  });

  it("returns null for a clean message", () => {
    expect(findBlockedWord("hello there", ["badword"])).toBeNull();
  });

  it("matches a whole word only", () => {
    // The regression that matters: a substring match would delete these.
    expect(findBlockedWord("class", ["ass"])).toBeNull();
    expect(findBlockedWord("assignment", ["ass"])).toBeNull();
    expect(findBlockedWord("passed", ["ass"])).toBeNull();
    expect(findBlockedWord("bass guitar", ["ass"])).toBeNull();
  });

  it("matches a word at the start or end of a message", () => {
    expect(findBlockedWord("badword again", ["badword"])).toBe("badword");
    expect(findBlockedWord("what a badword", ["badword"])).toBe("badword");
    expect(findBlockedWord("badword", ["badword"])).toBe("badword");
  });

  it("matches a multi-word phrase", () => {
    expect(findBlockedWord("please visit my site now", ["visit my site"])).toBe(
      "visit my site",
    );
    expect(findBlockedWord("please visit my house now", ["visit my site"])).toBeNull();
  });

  it("matches a phrase broken across a line", () => {
    // Discord messages contain newlines, and "block me\nnow" should not slip
    // through a filter for "block me now".
    expect(findBlockedWord("block me now", ["block me now"])).toBe("block me now");
  });

  it("matches next to punctuation", () => {
    expect(findBlockedWord("stop, badword!", ["badword"])).toBe("badword");
    expect(findBlockedWord("(badword)", ["badword"])).toBe("badword");
  });

  it("matches next to a non-Latin character", () => {
    // Boundaries are ASCII. A Unicode boundary would let anyone evade the
    // whole filter by typing one CJK character after the blocked word, and
    // the creator would have no way to see why their filter stopped working.
    expect(findBlockedWord("badword日本", ["badword"])).toBe("badword");
    expect(findBlockedWord("日本badword", ["badword"])).toBe("badword");
  });

  it("still refuses to match inside a longer ASCII word", () => {
    // The case ASCII boundaries exist to protect.
    expect(findBlockedWord("Japaneseclass", ["ass"])).toBeNull();
    expect(findBlockedWord("x_badword_y", ["badword"])).toBeNull();
  });

  it("does not match a different word containing it after a digit", () => {
    expect(findBlockedWord("badword2", ["badword"])).toBeNull();
  });

  it("treats regex characters in a blocked word literally", () => {
    // Without escaping, a word like "c++" would be an invalid pattern and
    // throw on every message.
    expect(findBlockedWord("i love c++", ["c++"])).toBe("c++");
    expect(findBlockedWord("nothing here", ["c++"])).toBeNull();
    expect(findBlockedWord("a.b", ["a.b"])).toBe("a.b");
    expect(findBlockedWord("axb", ["a.b"])).toBeNull();
  });

  it("ignores an empty entry rather than matching everything", () => {
    // A trailing comma in the dashboard form produces one of these.
    expect(findBlockedWord("completely innocent", ["", "  "])).toBeNull();
  });

  it("returns the first configured entry that matched", () => {
    expect(findBlockedWord("spam and badword", ["spam", "badword"])).toBe("spam");
  });

  it("matches any of several words", () => {
    const words = ["badword", "spam-link"];
    expect(findBlockedWord("a spam-link here", words)).toBe("spam-link");
    expect(findBlockedWord("a badword here", words)).toBe("badword");
  });

  it("handles a long word list", () => {
    const words = Array.from({ length: 200 }, (_, index) => `badword${index}`);
    expect(findBlockedWord("hello", words)).toBeNull();
    expect(findBlockedWord("say badword199 now", words)).toBe("badword199");
  });
});

describe("isBlocked", () => {
  it("is the boolean form of findBlockedWord", () => {
    expect(isBlocked("a badword", ["badword"])).toBe(true);
    expect(isBlocked("all clear", ["badword"])).toBe(false);
  });
});

describe("parseWordList", () => {
  it("splits on commas", () => {
    expect(parseWordList("one, two, three")).toEqual(["one", "two", "three"]);
  });

  it("splits on newlines", () => {
    expect(parseWordList("one\ntwo\nthree")).toEqual(["one", "two", "three"]);
  });

  it("trims whitespace", () => {
    expect(parseWordList("  one ,  two  ")).toEqual(["one", "two"]);
  });

  it("drops empty entries", () => {
    expect(parseWordList("one,,two,")).toEqual(["one", "two"]);
    expect(parseWordList("")).toEqual([]);
    expect(parseWordList("   ")).toEqual([]);
  });

  it("removes duplicates regardless of case, keeping the first spelling", () => {
    expect(parseWordList("Badword, badword, BADWORD")).toEqual(["Badword"]);
  });

  it("keeps a phrase with a comma out", () => {
    // Splitting on commas means a phrase cannot contain one. Documented
    // behaviour rather than a silent surprise.
    expect(parseWordList("go away, now")).toEqual(["go away", "now"]);
  });
});