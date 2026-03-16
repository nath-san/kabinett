import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchArtistsByScope } from "../artist-search.server";

let db: Database.Database;

const nordiskaSource = { sql: "a.source IN (?)", params: ["nordiska"] };
const shmSource = { sql: "a.source IN (?)", params: ["shm"] };
const lhkMuseum = { sql: "a.source = ? AND a.sub_museum = ?", params: ["shm", "Livrustkammaren"] };

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE artworks (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      sub_museum TEXT,
      iiif_url TEXT,
      title_sv TEXT
    );

    CREATE TABLE broken_images (
      artwork_id INTEGER PRIMARY KEY
    );

    CREATE TABLE artwork_artists (
      artwork_id INTEGER NOT NULL,
      artist_name TEXT NOT NULL,
      artist_name_norm TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (artwork_id, artist_name_norm)
    );
  `);
});

afterEach(() => {
  db.close();
});

describe("searchArtistsByScope", () => {
  it("excludes artists whose works only exist outside the active source filter", () => {
    db.prepare(
      `INSERT INTO artworks (id, source, iiif_url, title_sv) VALUES (?, ?, ?, ?)`
    ).run(1, "nationalmuseum", "https://example.org/iiif/nm-carl-larsson-abcdefghijklmnopqrstuvwxyz", "Carl målning");

    db.prepare(
      `INSERT INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
       VALUES (?, ?, ?, ?)`
    ).run(1, "Carl Larsson", "carl larsson", 0);

    const results = searchArtistsByScope({
      db,
      query: "carl",
      source: nordiskaSource,
      limit: 10,
    });

    expect(results).toEqual([]);
  });

  it("counts only artworks within the active source scope", () => {
    db.prepare(
      `INSERT INTO artworks (id, source, iiif_url, title_sv) VALUES (?, ?, ?, ?)`
    ).run(1, "nordiska", "https://example.org/iiif/nordiska-anna-1-abcdefghijklmnopqrstuvwxyz", "Verk 1");
    db.prepare(
      `INSERT INTO artworks (id, source, iiif_url, title_sv) VALUES (?, ?, ?, ?)`
    ).run(2, "nationalmuseum", "https://example.org/iiif/nm-anna-2-abcdefghijklmnopqrstuvwxyz", "Verk 2");

    db.prepare(
      `INSERT INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
       VALUES (?, ?, ?, ?)`
    ).run(1, "Anna Blom", "anna blom", 0);
    db.prepare(
      `INSERT INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
       VALUES (?, ?, ?, ?)`
    ).run(2, "Anna Blom", "anna blom", 0);

    const results = searchArtistsByScope({
      db,
      query: "anna",
      source: nordiskaSource,
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: "Anna Blom",
      artwork_count: 1,
    });
  });

  it("respects museum fragments inside a scoped source", () => {
    db.prepare(
      `INSERT INTO artworks (id, source, sub_museum, iiif_url, title_sv) VALUES (?, ?, ?, ?, ?)`
    ).run(1, "shm", "Livrustkammaren", "https://example.org/iiif/shm-lhk-abcdefghijklmnopqrstuvwxyz", "Verk 1");
    db.prepare(
      `INSERT INTO artworks (id, source, sub_museum, iiif_url, title_sv) VALUES (?, ?, ?, ?, ?)`
    ).run(2, "shm", "Historiska museet", "https://example.org/iiif/shm-hm-abcdefghijklmnopqrstuvwxyz", "Verk 2");

    db.prepare(
      `INSERT INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
       VALUES (?, ?, ?, ?)`
    ).run(1, "Eva Rustning", "eva rustning", 0);
    db.prepare(
      `INSERT INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
       VALUES (?, ?, ?, ?)`
    ).run(2, "Eva Rustning", "eva rustning", 0);

    const results = searchArtistsByScope({
      db,
      query: "eva",
      source: shmSource,
      museum: lhkMuseum,
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      name: "Eva Rustning",
      artwork_count: 1,
    });
  });
});
