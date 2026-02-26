import { describe, expect, it } from "vitest";
import { MULTILINGUAL_CLIP_TEXT_MODEL } from "../clip-search.server";

describe("clip multilingual model", () => {
  it("uses the multilingual sentence-transformers checkpoint", () => {
    expect(MULTILINGUAL_CLIP_TEXT_MODEL).toBe("sentence-transformers/clip-ViT-B-32-multilingual-v1");
  });
});
