import { describe, expect, it } from "vitest";
import { parseArtist } from "../parsing";

describe("parseArtist", () => {
  it("returns first artist name for valid JSON", () => {
    const result = parseArtist('[{"name":"Anders Zorn"},{"name":"Carl Larsson"}]');

    expect(result).toBe("Anders Zorn");
  });

  it("returns unknown artist for null", () => {
    expect(parseArtist(null)).toBe("Okänd konstnär");
  });

  it("returns unknown artist for malformed JSON", () => {
    expect(parseArtist("{not-json")).toBe("Okänd konstnär");
  });

  it("returns unknown artist for empty array", () => {
    expect(parseArtist("[]")).toBe("Okänd konstnär");
  });
});
