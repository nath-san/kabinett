import { useState, useRef, useEffect, useCallback } from "react";

type GridWork = {
  id: string | number;
  title: string;
  artist?: string;
  imageUrl: string;
  color: string;
  year: string;
};

type Props = {
  fetchUrl: string;
  heading?: string;
};

export default function InfiniteArtworkGrid({ fetchUrl, heading = "Alla verk" }: Props) {
  const [works, setWorks] = useState<GridWork[]>([]);
  const [canLoadMore, setCanLoadMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !canLoadMore) return;
    setLoading(true);
    try {
      const separator = fetchUrl.includes("?") ? "&" : "?";
      const res = await fetch(`${fetchUrl}${separator}offset=${works.length}`);
      if (!res.ok) throw new Error("Kunde inte ladda verk");
      const data = (await res.json()) as { works: GridWork[]; hasMore: boolean };
      if (data.works.length === 0) {
        setCanLoadMore(false);
      } else {
        setWorks((prev) => [...prev, ...data.works]);
        setCanLoadMore(data.hasMore);
      }
    } catch {
      setCanLoadMore(false);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [fetchUrl, canLoadMore, loading, works.length]);

  // Reset when fetchUrl changes
  useEffect(() => {
    setWorks([]);
    setCanLoadMore(true);
    setInitialLoad(true);
  }, [fetchUrl]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  if (works.length === 0 && !canLoadMore && !initialLoad) return null;

  return (
    <section className="pt-10 pb-16">
      <h2 className="font-serif text-[1.4rem] text-charcoal mb-4">{heading}</h2>
      <div className="columns-2 [column-gap:0.8rem] md:columns-3 lg:columns-4 lg:[column-gap:1rem]">
        {works.map((w) => (
          <a
            key={w.id}
            href={`/artwork/${w.id}`}
            className="break-inside-avoid block rounded-[0.8rem] overflow-hidden bg-linen mb-[0.8rem] no-underline focus-ring"
          >
            <div
              className="aspect-[3/4] overflow-hidden"
              style={{ backgroundColor: w.color }}
            >
              <img
                src={w.imageUrl}
                alt={w.title}
                width={400}
                height={533}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.classList.add("is-broken");
                }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-[0.7rem]">
              <p className="text-[0.84rem] font-medium text-charcoal leading-[1.35] overflow-hidden line-clamp-2 min-h-[2.25rem]">
                {w.title}
              </p>
              {(w.artist || w.year) && (
                <p className="text-[0.72rem] text-warm-gray mt-[0.35rem] leading-[1.3] overflow-hidden line-clamp-1">
                  {w.artist}
                  {w.artist && w.year ? " · " : ""}
                  {w.year}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>
      <div ref={sentinelRef} className="h-4" />
      {loading && (
        <p className="text-center text-[0.85rem] text-warm-gray py-4">
          Laddar fler verk…
        </p>
      )}
    </section>
  );
}
