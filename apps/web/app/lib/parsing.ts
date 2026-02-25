const UNKNOWN_ARTIST = "Okänd konstnär";

type ArtistCandidate = {
  name?: string;
};

type DimensionCandidate = {
  dimension_text?: string;
  dimension?: string;
  value?: string;
  width?: number | string;
  height?: number | string;
  bredd?: number | string;
  hojd?: number | string;
  W?: number | string;
  H?: number | string;
};

export function parseArtist(json: string | null): string {
  if (!json) return UNKNOWN_ARTIST;
  try {
    const parsed = JSON.parse(json) as ArtistCandidate[] | ArtistCandidate;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first?.name || UNKNOWN_ARTIST;
  } catch {
    return UNKNOWN_ARTIST;
  }
}

export function formatDimensions(json: string | null): string {
  if (!json) return "";

  try {
    const parsed = JSON.parse(json) as DimensionCandidate[] | DimensionCandidate;
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const dimensions = candidates
      .map((candidate) => {
        if (!candidate) return "";
        if (candidate.dimension_text) return String(candidate.dimension_text);
        if (candidate.dimension) return String(candidate.dimension);
        if (candidate.value) return String(candidate.value);

        const width = candidate.width ?? candidate.bredd ?? candidate.W;
        const height = candidate.height ?? candidate.hojd ?? candidate.H;
        if (width && height) return `${width} × ${height}`;
        return "";
      })
      .filter(Boolean);

    return dimensions.join(", ");
  } catch {
    return "";
  }
}
