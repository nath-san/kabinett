import {
  buildArtworkAltText,
  focalObjectPosition,
  type ArtworkDisplayItem,
} from "./artwork-meta";
import { useScrollReveal } from "../hooks/useScrollReveal";

export type SpotlightCardData = {
  artistName: string;
  items: ArtworkDisplayItem[];
};

export default function SpotlightCard({ spotlight }: { spotlight: SpotlightCardData }) {
  const ref = useScrollReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      className="reveal-on-scroll bg-dark-base rounded-none lg:rounded-section px-5 py-9 md:px-7 md:py-10 lg:px-10 lg:py-12 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-7"
    >
      <div className="lg:max-w-[22rem]">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-dark-text-muted font-medium">Konstnär i fokus</p>
        <h2 className="font-serif text-[1.8rem] md:text-[2rem] text-dark-text leading-[1.05] mt-2.5">
          {spotlight.artistName}
        </h2>
        <a
          href={`/artist/${encodeURIComponent(spotlight.artistName)}`}
          className="inline-block mt-5 text-[0.78rem] tracking-[0.03em] text-dark-text-secondary hover:text-dark-text transition-colors no-underline focus-ring"
        >
          Utforska konstnären →
        </a>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {spotlight.items.map((item) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[8.5rem] h-[8.5rem] rounded-lg overflow-hidden block hover:ring-2 hover:ring-dark-text/20 transition-shadow focus-ring"
            style={{ backgroundColor: item.dominant_color || "#1A1815" }}
          >
            <img
              src={item.imageUrl}
              alt={buildArtworkAltText(item)}
              loading="lazy"
              width={140}
              height={140}
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
