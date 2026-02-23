import { useEffect, useMemo, useRef, useState } from "react";
import { useFavorites } from "../lib/favorites";

export function meta() {
  return [
    { title: "Favoriter — Kabinett" },
    { name: "description", content: "Dina sparade konstverk i Kabinett." },
  ];
}

type FavoriteItem = {
  id: number;
  title: string;
  artists: string | null;
  dominant_color: string;
  imageUrl: string;
};

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export default function Favorites() {
  const { ids, remove } = useFavorites();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const idsKey = useMemo(() => ids.join(","), [ids]);

  useEffect(() => {
    if (!idsKey) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/artworks?ids=${idsKey}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => setItems(data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [idsKey]);

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "1.5rem" }}>
        <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: "2rem", color: "#3D3831" }}>
          Favoriter
        </h1>
        <p style={{ marginTop: "0.35rem", color: "#8C8478", fontSize: "0.95rem" }}>
          Tryck länge eller svep i sidled för att ta bort.
        </p>

        {loading && items.length === 0 && (
          <div style={{ padding: "2rem 0", color: "#8C8478" }}>Hämtar favoriter…</div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ padding: "2rem 0", color: "#8C8478" }}>
            Inga sparade verk än. Tryck på hjärtat för att spara.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "1rem",
            marginTop: "1.5rem",
          }}
        >
          {items.map((item) => (
            <FavoriteCard key={item.id} item={item} onRemove={remove} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FavoriteCard({ item, onRemove }: { item: FavoriteItem; onRemove: (id: number) => void }) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const removedRef = useRef(false);

  function clearPress() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  }

  return (
    <a
      href={`/artwork/${item.id}`}
      onPointerDown={(event) => {
        removedRef.current = false;
        startRef.current = { x: event.clientX, y: event.clientY };
        timerRef.current = window.setTimeout(() => {
          onRemove(item.id);
          removedRef.current = true;
        }, 600);
      }}
      onPointerMove={(event) => {
        if (!startRef.current || removedRef.current) return;
        const dx = event.clientX - startRef.current.x;
        const dy = event.clientY - startRef.current.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          onRemove(item.id);
          removedRef.current = true;
          clearPress();
        }
      }}
      onPointerUp={(event) => {
        clearPress();
        if (removedRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerCancel={clearPress}
      onClick={(event) => {
        if (removedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          removedRef.current = false;
        }
      }}
      style={{
        textDecoration: "none",
        color: "inherit",
        background: "#fff",
        borderRadius: "0.85rem",
        overflow: "hidden",
        boxShadow: "0 10px 24px rgba(0,0,0,0.06)",
        border: "1px solid rgba(212,205,195,0.3)",
      }}
    >
      <div style={{ aspectRatio: "3/4", backgroundColor: item.dominant_color || "#D4CDC3" }}>
        <img
          src={item.imageUrl}
          alt={item.title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={{ padding: "0.75rem" }}>
        <p style={{ fontSize: "0.9rem", fontWeight: 600, color: "#3D3831", margin: 0 }}>
          {item.title}
        </p>
        <p style={{ marginTop: "0.2rem", fontSize: "0.75rem", color: "#8C8478" }}>
          {parseArtist(item.artists)}
        </p>
      </div>
    </a>
  );
}
