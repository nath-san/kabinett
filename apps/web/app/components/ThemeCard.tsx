import { buildImageUrl } from "../lib/images";
import { useScrollReveal } from "../hooks/useScrollReveal";
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
  searchType: "all" | "visual";
  items: ArtworkDisplayItem[];
};

export default function ThemeCard({ section, showMuseumBadge }: { section: ThemeCardSection; showMuseumBadge: boolean }) {
  const ref = useScrollReveal<HTMLDivElement>();
  const query = section.filter || section.title;
  const searchParams = new URLSearchParams({ q: query });
  if (section.searchType === "visual") searchParams.set("type", "visual");
  const searchHref = `/search?${searchParams.toString()}`;

  return (
    <div
      ref={ref}
      className="reveal-on-scroll pt-10 md:pt-12 px-5 md:px-6 lg:px-8 pb-9 md:pb-10 snap-start lg:rounded-section lg:overflow-hidden"
      style={{ backgroundColor: section.color }}
    >
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.30)] font-medium">
        Tema
      </p>
      <h2 className="font-serif text-[1.8rem] md:text-[2rem] font-semibold text-white mt-2.5 leading-[1.1]">
        {section.title}
      </h2>
      <p className="text-[0.8rem] text-[rgba(255,255,255,0.42)] mt-[0.35rem]">
        {section.subtitle}
      </p>

      <div className="flex gap-3 md:gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-4 lg:gap-3.5 overflow-x-auto lg:overflow-visible pt-7 pb-2 lg:pb-0 snap-x snap-mandatory lg:snap-none no-scrollbar">
        {section.items.map((item) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[70vw] max-w-[280px] lg:w-auto lg:max-w-none rounded-card overflow-hidden no-underline text-inherit snap-start lg:snap-none group/theme focus-ring transition-transform duration-400 hover:-translate-y-1 hover:scale-[1.06]"
            style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
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
                className="w-full h-full object-cover opacity-0 transition-[opacity,transform] duration-[400ms] group-hover/theme:scale-[1.06]"
                style={{
                  objectPosition: focalObjectPosition(item.focal_x, item.focal_y),
                  transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
                }}
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

      <a
        href={searchHref}
        className="inline-flex items-center gap-1 mt-5 text-[0.75rem] tracking-[0.03em] text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.75)] transition-[color,gap] duration-300 no-underline focus-ring group/link"
      >
        Visa fler
        <span className="inline-block transition-transform duration-300 group-hover/link:translate-x-1" style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}>→</span>
      </a>
    </div>
  );
}
