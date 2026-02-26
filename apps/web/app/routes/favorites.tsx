import { useEffect, useMemo, useRef, useState } from "react";
import { useFavorites } from "../lib/favorites";
import { parseArtist } from "../lib/parsing";

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
  focal_x?: number | null;
  focal_y?: number | null;
};

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
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      <div className="max-w-[64rem] lg:max-w-6xl mx-auto p-6">
        <h1 className="font-serif text-[2rem] text-charcoal">
          Favoriter
        </h1>
        <p className="mt-[0.35rem] text-warm-gray text-[0.95rem]">
          Tryck länge eller svep i sidled för att ta bort.
        </p>

        {loading && items.length === 0 && (
          <div aria-live="polite" className="py-8 text-warm-gray">Hämtar favoriter…</div>
        )}

        {!loading && items.length === 0 && (
          <div aria-live="polite" className="py-8 text-warm-gray">
            Inga sparade verk än. Tryck på hjärtat för att spara.
          </div>
        )}

        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 mt-6"
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
      className="no-underline text-inherit bg-white rounded-[0.85rem] overflow-hidden shadow-[0_10px_24px_rgba(0,0,0,0.06)] border border-[rgba(212,205,195,0.3)] focus-ring"
    >
      <div
        className="aspect-[3/4]"
        style={{ backgroundColor: item.dominant_color || "#D4CDC3" }}
      >
        <img
          src={item.imageUrl}
          alt={`${item.title} — ${parseArtist(item.artists)}`}
          loading="lazy"
          width={400}
          height={533}
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
          className="w-full h-full object-cover"
          style={{ objectPosition: `${(item.focal_x ?? 0.5) * 100}% ${(item.focal_y ?? 0.5) * 100}%` }}
        />
      </div>
      <div className="p-3">
        <p className="text-[0.9rem] font-semibold text-charcoal m-0">
          {item.title}
        </p>
        <p className="mt-[0.2rem] text-[0.75rem] text-warm-gray">
          {parseArtist(item.artists)}
        </p>
      </div>
    </a>
  );
}
