import {
  buildArtworkAltText,
  focalObjectPosition,
  type ArtworkDisplayItem,
} from "./artwork-meta";

export type SpotlightCardData = {
  artistName: string;
  items: ArtworkDisplayItem[];
};

export default function SpotlightCard({ spotlight }: { spotlight: SpotlightCardData }) {
  return (
    <section className="bg-[#1E1D1A] rounded-none lg:rounded-[1.5rem] px-4 py-6 md:px-6 md:py-7 lg:px-8 lg:py-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
      <div className="lg:max-w-[24rem]">
        <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.45)]">Konstnär i fokus</p>
        <h2 className="font-serif text-[2rem] md:text-[2.2rem] text-[#F5F0E8] leading-[1.05] mt-2">
          {spotlight.artistName}
        </h2>
        <a
          href={`/search?q=${encodeURIComponent(spotlight.artistName)}`}
          className="inline-block mt-4 text-[0.8rem] tracking-[0.02em] text-[rgba(245,240,232,0.75)] no-underline focus-ring"
        >
          Utforska konstnären →
        </a>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {spotlight.items.map((item) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[7.5rem] h-[7.5rem] rounded-lg overflow-hidden block focus-ring"
            style={{ backgroundColor: item.dominant_color || "#1A1815" }}
          >
            <img
              src={item.imageUrl}
              alt={buildArtworkAltText(item)}
              loading="lazy"
              width={120}
              height={120}
              onLoad={(event) => {
                const img = event.currentTarget;
                img.classList.remove("opacity-0");
                img.classList.add("opacity-100");
              }}
              onError={(event) => {
                event.currentTarget.classList.add("is-broken");
              }}
              className="w-full h-full object-cover opacity-0 transition-opacity duration-[400ms] ease-[ease]"
              style={{ objectPosition: focalObjectPosition(item.focal_x, item.focal_y) }}
            />
          </a>
        ))}
      </div>
    </section>
  );
}

