import { beforeEach, describe, expect, it, vi } from "vitest";

const allMock = vi.fn();
const getRequestContextMock = vi.fn();

vi.mock("../db.server", () => ({
  getDb: () => ({
    prepare: () => ({
      all: allMock,
    }),
  }),
}));

vi.mock("../request-context.server", () => ({
  getRequestContext: () => getRequestContextMock(),
}));

import { getEnabledMuseums, sourceFilter } from "../museums.server";

describe("museums.server", () => {
  beforeEach(() => {
    delete process.env.MUSEUMS;
    allMock.mockReset();
    getRequestContextMock.mockReset();
    getRequestContextMock.mockReturnValue(undefined);
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

  it("prefers default request context over env museum fallback", () => {
    process.env.MUSEUMS = "nm";
    getRequestContextMock.mockReturnValue({ campaignId: "default", museums: null });

    expect(getEnabledMuseums()).toEqual(["nm", "shm"]);
  });

  it("uses request context museum filter when provided", () => {
    process.env.MUSEUMS = "nm,shm";
    getRequestContextMock.mockReturnValue({ campaignId: "europeana", museums: ["shm"] });

    expect(getEnabledMuseums()).toEqual(["shm"]);
  });
});
