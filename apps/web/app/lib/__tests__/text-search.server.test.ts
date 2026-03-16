import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildArtworkSnippet, searchArtworksAutocomplete, searchArtworksText } from "../text-search.server";

let db: Database.Database;

const source = { sql: "a.source IN (?)", params: ["nordiska"] };
const museum = { sql: "a.source = ?", params: ["nordiska"] };

function seedSchema(database: Database.Database) {
  database.exec(`
    CREATE TABLE museums (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE artworks (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      sub_museum TEXT,
      title_sv TEXT,
      title_en TEXT,
      iiif_url TEXT,
      dominant_color TEXT,
      artists TEXT,
      dating_text TEXT,
      technique_material TEXT,
      descriptions_sv TEXT,
      focal_x REAL,
      focal_y REAL,
      category TEXT,
      object_type_sv TEXT,
      material_tags TEXT,
      technique_tags TEXT,
      style_sv TEXT,
      signature TEXT,
      inscription TEXT
    );

    CREATE TABLE broken_images (
      artwork_id INTEGER PRIMARY KEY
    );

    CREATE VIRTUAL TABLE artworks_fts USING fts5(
      title_sv,
      title_en,
      artists,
      technique_material,
      category,
      content='artworks',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  database.prepare("INSERT INTO museums (id, name) VALUES (?, ?)").run("nordiska", "Nordiska museet");
}

beforeEach(() => {
  db = new Database(":memory:");
  seedSchema(db);
});

afterEach(() => {
  db.close();
});

describe("searchArtworksText", () => {
  it("falls back to title LIKE when FTS misses a title hit", () => {
    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      -1,
      "nordiska",
      "Samisk trumma.",
      "https://example.org/iiif/samisk-trumma-abcdefghijklmnopqrstuvwxyz",
      "Trä och skinn",
      null
    );

    const results = searchArtworksText({
      db,
      query: "samisk",
      source,
      museum,
      limit: 10,
      scope: "title",
    });

    expect(results).toHaveLength(1);
    expect(results[0].title_sv).toBe("Samisk trumma.");
  });

  it("prefers lexical fallback when FTS results are too sparse", () => {
    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      1,
      "nordiska",
      "Samisk trumma.",
      "https://example.org/iiif/nordiska-samisk-trumma-abcdefghijklmnopqrstuvwxyz",
      "Trä och skinn",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      2,
      "nordiska",
      "Samisk vagga.",
      "https://example.org/iiif/nordiska-samisk-vagga-abcdefghijklmnopqrstuvwxyz",
      "Trä",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      3,
      "nordiska",
      "Samisk seijte.",
      "https://example.org/iiif/nordiska-samisk-seijte-abcdefghijklmnopqrstuvwxyz",
      "Sten",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      4,
      "nordiska",
      "Samisk kniv.",
      "https://example.org/iiif/nordiska-samisk-kniv-abcdefghijklmnopqrstuvwxyz",
      "Metall",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      5,
      "nordiska",
      "Samisk kåsa.",
      "https://example.org/iiif/nordiska-samisk-kasa-abcdefghijklmnopqrstuvwxyz",
      "Trä",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      10,
      "nordiska",
      "Orelaterat verk",
      "https://example.org/iiif/nordiska-orelaterat-abcdefghijklmnopqrstuvwxyz",
      "Fotografi",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      20,
      "nordiska",
      "Neutral titel",
      "https://example.org/iiif/nordiska-neutral-abcdefghijklmnopqrstuvwxyz",
      "Fotografi",
      "Beskrivning om samisk kultur."
    );

    db.prepare(
      "INSERT INTO artworks_fts(rowid, title_sv, title_en, artists, technique_material, category) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      10,
      "Orelaterat verk",
      null,
      "Britta Marakatt",
      "Samisk textil",
      null
    );

    const results = searchArtworksText({
      db,
      query: "samisk",
      source,
      museum,
      limit: 10,
      scope: "broad",
    });

    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results[0].title_sv).toBe("Samisk kåsa.");
    expect(results.some((row) => row.title_sv === "Samisk trumma.")).toBe(true);
  });

  it("falls back to broad LIKE when the term only exists outside indexed FTS fields", () => {
    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv, category
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      -2,
      "nordiska",
      "Okänt verk",
      "https://example.org/iiif/samiskt-liv-abcdefghijklmnopqrstuvwxyz",
      "Fotografi",
      "Dokumentation av samiskt liv i Jokkmokk.",
      "Foto"
    );

    const results = searchArtworksText({
      db,
      query: "samiskt",
      source,
      museum,
      limit: 10,
      scope: "broad",
    });

    expect(results).toHaveLength(1);
    expect(results[0].descriptions_sv).toContain("samiskt liv");
  });
});

describe("searchArtworksAutocomplete", () => {
  it("falls back to title LIKE when the FTS index has no matching row", () => {
    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      101,
      "nordiska",
      "Samisk trumma.",
      "https://example.org/iiif/autocomplete-samisk-trumma-abcdefghijklmnopqrstuvwxyz",
      "Trä och skinn",
      null
    );

    const results = searchArtworksAutocomplete({
      db,
      query: "samisk",
      source,
      museum,
      limit: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0].title_sv).toBe("Samisk trumma.");
  });

  it("returns sparse title hits without broadening to descriptive matches", () => {
    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      201,
      "nordiska",
      "Samisk kniv",
      "https://example.org/iiif/autocomplete-samisk-kniv-abcdefghijklmnopqrstuvwxyz",
      "Stål",
      null
    );

    db.prepare(
      `INSERT INTO artworks (
         id, source, title_sv, iiif_url, technique_material, descriptions_sv
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      202,
      "nordiska",
      "Neutral titel",
      "https://example.org/iiif/autocomplete-neutral-abcdefghijklmnopqrstuvwxyz",
      "Textil",
      "Beskrivning om samisk kultur."
    );

    db.prepare(
      "INSERT INTO artworks_fts(rowid, title_sv, title_en, artists, technique_material, category) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      201,
      "Samisk kniv",
      null,
      null,
      "Stål",
      null
    );

    const results = searchArtworksAutocomplete({
      db,
      query: "samisk",
      source,
      museum,
      limit: 3,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(201);
  });
});

describe("buildArtworkSnippet", () => {
  it("prefers the matching technique or description context", () => {
    const snippet = buildArtworkSnippet(
      {
        technique_material: "Silver, läder och samiska pärlor",
        descriptions_sv: null,
      },
      "samiska"
    );

    expect(snippet).toContain("samiska pärlor");
  });
});
