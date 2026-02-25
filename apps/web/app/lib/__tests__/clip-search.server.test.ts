import { describe, expect, it } from "vitest";
import { lookupTranslate } from "../clip-search.server";

describe("lookupTranslate", () => {
  it("maps known Swedish words to English", () => {
    expect(lookupTranslate("djur").result).toContain("animals");
    expect(lookupTranslate("häst").result).toContain("horse");
    expect(lookupTranslate("äpple").result).toContain("apple");
  });

  it("passes unknown words through unchanged", () => {
    const result = lookupTranslate("okäntord");

    expect(result.result).toBe("okäntord");
    expect(result.allFound).toBe(false);
  });
});
