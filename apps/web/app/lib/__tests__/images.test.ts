import { describe, expect, it } from "vitest";
import { buildImageUrl } from "../images";

describe("images", () => {
  it("buildImageUrl returns sized IIIF URL for Nationalmuseum-style base URL", () => {
    const result = buildImageUrl("https://api.nationalmuseum.se/iiif/image/12345", 400);

    expect(result).toBe("https://api.nationalmuseum.se/iiif/image/12345/full/400,/0/default.jpg");
  });

  it("buildImageUrl updates dimension param for Nordiska dimu URL", () => {
    const result = buildImageUrl("https://ems.dimu.org/image/022w?dimension=1200x1200", 200);

    expect(result).toBe(`/cdn/img?url=${encodeURIComponent("https://ems.dimu.org/image/022w?dimension=200x200")}`);
  });

  it("buildImageUrl switches SHM size variants", () => {
    const result = buildImageUrl("https://example.org/object/thumbnail", 800);

    expect(result).toBe("https://example.org/object/full");
  });

  it("buildImageUrl returns empty string for null or empty input", () => {
    expect(buildImageUrl(null, 400)).toBe("");
    expect(buildImageUrl("", 400)).toBe("");
  });
});
