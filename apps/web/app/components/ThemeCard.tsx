import { buildImageUrl } from "../lib/images";
import {
  artworkArtist,
  buildArtworkAltText,
  focalObjectPosition,
  type ArtworkDisplayItem,
} from "./artwork-meta";

export type ThemeCardSection = {
  title: string;
  subtitle: string;
  filter: string;
  color: string;
  items: ArtworkDisplayItem[];
};

export default function ThemeCard({ section, showMuseumBadge }: { section: ThemeCardSection; showMuseumBadge: boolean }) {
  return (
    <div
      className="pt-12 px-4 md:px-6 lg:px-8 pb-8 snap-start lg:rounded-[1.5rem] lg:overflow-hidden"
      style={{ backgroundColor: section.color }}
    >
      <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.4)] font-medium">
        Tema
      </p>
      <h2 className="font-serif text-[2rem] font-semibold text-white mt-2 leading-[1.1]">
        {section.title}
      </h2>
      <p className="text-[0.85rem] text-[rgba(255,255,255,0.5)] mt-[0.35rem]">
        {section.subtitle}
      </p>

      <div className="flex gap-3 md:gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-4 lg:gap-4 overflow-x-auto lg:overflow-visible pt-6 pb-2 lg:pb-0 snap-x snap-mandatory lg:snap-none no-scrollbar">
        {section.items.map((item) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[70vw] max-w-[280px] lg:w-auto lg:max-w-none rounded-xl overflow-hidden no-underline text-inherit snap-start lg:snap-none focus-ring"
            style={{ backgroundColor: item.dominant_color || "#1A1815" }}
          >
            <div
              className="aspect-[3/4] overflow-hidden"
              style={{ backgroundColor: item.dominant_color || "#1A1815" }}
            >
              <img
                src={buildImageUrl(item.iiif_url, 400)}
                alt={buildArtworkAltText(item)}
                loading="lazy"
                width={400}
                height={533}
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
            </div>
            <div className="py-[0.6rem] px-3">
              <p className="text-[0.8rem] font-medium text-white leading-[1.3] overflow-hidden line-clamp-2">
                {item.title_sv || "Utan titel"}
              </p>
              <p className="text-[0.7rem] text-[rgba(255,255,255,0.6)] mt-[0.15rem]">
                {artworkArtist(item)}
              </p>
              {showMuseumBadge && item.museum_name && item.museum_name !== "Statens historiska museer" && (
                <p className="text-[0.65rem] text-[rgba(255,255,255,0.4)] mt-[0.1rem]">
                  {item.museum_name}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>

      <a href={`/search?q=${encodeURIComponent(section.filter || section.title)}`} className="inline-block mt-4 text-[0.8rem] text-[rgba(255,255,255,0.5)] no-underline focus-ring">
        Visa fler →
      </a>
    </div>
  );
}

