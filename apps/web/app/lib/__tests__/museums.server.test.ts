import { beforeEach, describe, expect, it, vi } from "vitest";

const allMock = vi.fn();

vi.mock("../db.server", () => ({
  getDb: () => ({
    prepare: () => ({
      all: allMock,
    }),
  }),
}));

import { getEnabledMuseums, sourceFilter } from "../museums.server";

describe("museums.server", () => {
  beforeEach(() => {
    delete process.env.MUSEUMS;
    allMock.mockReset();
    allMock.mockReturnValue([{ id: "nm" }, { id: "shm" }]);
  });

  it("getEnabledMuseums returns array of strings", () => {
    const museums = getEnabledMuseums();

    expect(Array.isArray(museums)).toBe(true);
    expect(museums).toEqual(["nm", "shm"]);
    expect(museums.every((item) => typeof item === "string")).toBe(true);
  });

  it("sourceFilter returns sql and params", () => {
    const filter = sourceFilter();

    expect(filter).toEqual({
      sql: "source IN (?,?)",
      params: ["nm", "shm"],
    });
  });

  it("sourceFilter with prefix uses aliased source column", () => {
    const filter = sourceFilter("a");

    expect(filter).toEqual({
      sql: "a.source IN (?,?)",
      params: ["nm", "shm"],
    });
  });
});
