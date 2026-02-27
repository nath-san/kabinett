import { parseArtist } from "../lib/parsing";

export type ArtworkDisplayItem = {
  id: number;
  title_sv: string | null;
  artists: string | null;
  artist_name?: string | null;
  dating_text: string | null;
  iiif_url: string;
  dominant_color: string | null;
  category: string | null;
  technique_material: string | null;
  imageUrl: string;
  museum_name: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

export function focalObjectPosition(focalX: number | null | undefined, focalY: number | null | undefined): string {
  const x = Number.isFinite(focalX) ? (focalX as number) : 0.5;
  const y = Number.isFinite(focalY) ? (focalY as number) : 0.5;
  return `${x * 100}% ${y * 100}%`;
}

export function artworkArtist(item: Pick<ArtworkDisplayItem, "artist_name" | "artists">): string {
  const explicitArtist = item.artist_name?.trim();
  if (explicitArtist) return explicitArtist;
  return parseArtist(item.artists ?? null);
}

export function buildArtworkAltText(
  item: Pick<ArtworkDisplayItem, "title_sv" | "artist_name" | "artists" | "technique_material" | "dating_text">
): string {
  const title = item.title_sv?.trim() || "Utan titel";
  const artist = artworkArtist(item);
  const details = [item.technique_material?.trim(), item.dating_text?.trim()].filter(Boolean);
  if (details.length === 0) {
    return `${title} av ${artist}`;
  }
  return `${title} av ${artist}, ${details.join(", ")}`;
}

