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
    <section className="bg-dark-base rounded-none lg:rounded-section px-5 py-8 md:px-7 md:py-9 lg:px-10 lg:py-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
      <div className="lg:max-w-[22rem]">
        <p className="text-[0.65rem] uppercase tracking-[0.2em] text-dark-text-muted font-medium">Konstnär i fokus</p>
        <h2 className="font-serif text-[1.8rem] md:text-[2rem] text-dark-text leading-[1.05] mt-2">
          {spotlight.artistName}
        </h2>
        <a
          href={`/artist/${encodeURIComponent(spotlight.artistName)}`}
          className="inline-block mt-4 text-[0.8rem] tracking-[0.03em] text-dark-text-secondary hover:text-dark-text transition-colors no-underline focus-ring"
        >
          Utforska konstnären →
        </a>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {spotlight.items.map((item) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[8rem] h-[8rem] rounded-lg overflow-hidden block hover:ring-2 hover:ring-dark-text/20 transition-shadow focus-ring"
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
