import { describe, expect, it, vi } from "vitest";

const allMock = vi.fn();

vi.mock("../db.server", () => ({
  getDb: () => ({
    prepare: () => ({
      all: allMock,
    }),
  }),
}));

vi.mock("../museums.server", () => ({
  getEnabledMuseums: () => ["nm"],
  sourceFilter: (prefix?: string) => ({
    sql: prefix ? `${prefix}.source IN (?)` : "source IN (?)",
    params: ["nm"],
  }),
}));

import { fetchFeed } from "../feed.server";

describe("fetchFeed", () => {
  it("returns items with expected shape for filter Alla", async () => {
    allMock.mockReturnValue([
      {
        id: 99,
        title_sv: "Ett verk",
        title_en: null,
        artists: "[{\"name\":\"Konstnär\"}]",
        dating_text: "1888",
        iiif_url: "https://api.nationalmuseum.se/iiif/image/abcde1234567890",
        dominant_color: "#111111",
        category: "Måleri",
        technique_material: "Olja på duk",
        museum_name: "Nationalmuseum",
      },
    ]);

    const result = await fetchFeed({ limit: 10, filter: "Alla" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 99,
      title_sv: "Ett verk",
      dating_text: "1888",
      iiif_url: "https://api.nationalmuseum.se/iiif/image/abcde1234567890",
      dominant_color: "#111111",
      category: "Måleri",
      technique_material: "Olja på duk",
      museum_name: "Nationalmuseum",
    });
    expect(result.items[0].imageUrl).toContain("/full/400,/0/default.jpg");
    expect(result.mode).toBe("cursor");
  });
});
