import React, { useState } from "react";
import { useFavorites } from "../lib/favorites";
import { buildImageUrl } from "../lib/images";
import {
  artworkArtist,
  buildArtworkAltText,
  focalObjectPosition,
  type ArtworkDisplayItem,
} from "./artwork-meta";

export type CardVariant = "large" | "medium" | "small";

type BaseProps = {
  item: ArtworkDisplayItem;
  showMuseumBadge: boolean;
};

type FeedLayoutProps = BaseProps & {
  layout?: "feed";
  index: number;
  variant?: CardVariant;
};

type SearchLayoutProps = BaseProps & {
  layout: "search";
  yearLabel?: string | null;
};

type ArtworkCardProps = FeedLayoutProps | SearchLayoutProps;

const FeedArtworkCard = React.memo(function FeedArtworkCard({
  item,
  showMuseumBadge,
  index,
  variant = "small",
}: FeedLayoutProps) {
  const eager = index < 3;
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(item.id);
  const [pulsing, setPulsing] = useState(false);
  const variantClass = variant === "large"
    ? "lg:col-span-2 lg:aspect-[3/2] lg:max-h-[32rem]"
    : variant === "medium"
      ? "lg:col-span-2 lg:aspect-[5/2] lg:max-h-[20rem]"
      : "lg:col-span-1 lg:aspect-[3/4] lg:max-h-[32rem]";

  const mobileHeight = variant === "large"
    ? "h-[50vh] md:h-[70vh]"
    : variant === "medium"
      ? "h-[40vh] md:h-[45vh]"
      : "h-[45vh] md:h-[55vh]";

  return (
    <a
      href={`/artwork/${item.id}`}
      className={`block relative w-full ${mobileHeight} lg:h-auto no-underline text-inherit overflow-hidden contain-[layout_paint] lg:rounded-xl group/card focus-ring ${variantClass}`}
      style={{ backgroundColor: item.dominant_color || "#1A1815" }}
    >
      <img
        src={item.imageUrl}
        srcSet={item.iiif_url ? `${buildImageUrl(item.iiif_url, 400)} 400w, ${buildImageUrl(item.iiif_url, 800)} 800w, ${buildImageUrl(item.iiif_url, 1200)} 1200w` : undefined}
        sizes={variant === "large" ? "(max-width: 768px) 100vw, 66vw" : "(max-width: 768px) 100vw, 33vw"}
        alt={buildArtworkAltText(item)}
        loading={eager ? "eager" : "lazy"}
        decoding="auto"
        fetchPriority={eager ? "high" : undefined}
        onLoad={eager ? undefined : (event) => {
          const img = event.currentTarget;
          img.classList.remove("opacity-0");
          img.classList.add("opacity-100");
        }}
        onError={(event) => {
          event.currentTarget.classList.add("is-broken");
        }}
        className={[
          "absolute inset-0 w-full h-full object-cover",
          eager ? "" : "opacity-0 lg:opacity-100",
        ].join(" ")}
        style={{ objectPosition: focalObjectPosition(item.focal_x, item.focal_y) }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.85)_0%,rgba(0,0,0,0.4)_30%,transparent_55%)] pointer-events-none lg:opacity-70 lg:group-hover/card:opacity-100 lg:transition-opacity lg:duration-500" />
      <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-7" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6), 0 0 12px rgba(0,0,0,0.3)" }}>
        <p className="font-serif text-[1.5rem] lg:text-[1.7rem] font-semibold text-white leading-[1.2] mb-[0.35rem] line-clamp-2">
          {item.title_sv || "Utan titel"}
        </p>
        <p className="text-[0.85rem] lg:text-[0.9rem] text-[rgba(255,255,255,0.75)]">
          {artworkArtist(item)}
        </p>
        {showMuseumBadge && item.museum_name && item.museum_name !== "Statens historiska museer" && (
          <p className="text-[0.75rem] text-[rgba(255,255,255,0.45)] mt-[0.2rem]">
            {item.museum_name}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={saved ? "Ta bort favorit" : "Spara som favorit"}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!saved) {
            setPulsing(true);
            window.setTimeout(() => setPulsing(false), 350);
          }
          toggle(item.id);
        }}
        className={[
          "absolute right-5 bottom-5 lg:right-6 lg:bottom-6 w-11 h-11 lg:w-[2.75rem] lg:h-[2.75rem] rounded-full border border-[rgba(255,255,255,0.2)] text-white inline-flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[transform,background] ease-[ease] duration-[200ms]",
          "focus-ring",
          saved ? "bg-[rgba(196,85,58,0.95)]" : "bg-[rgba(0,0,0,0.4)]",
          pulsing ? "heart-pulse" : "",
        ].join(" ")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.8 5.6c-1.4-1.6-3.9-1.6-5.3 0L12 9.1 8.5 5.6c-1.4-1.6-3.9-1.6-5.3 0-1.6 1.8-1.4 4.6.2 6.2L12 21l8.6-9.2c1.6-1.6 1.8-4.4.2-6.2z" />
        </svg>
      </button>
    </a>
  );
});

const SearchArtworkCard = React.memo(function SearchArtworkCard({
  item,
  showMuseumBadge,
  yearLabel,
}: SearchLayoutProps) {
  return (
    <a
      href={`/artwork/${item.id}`}
      className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-[#252019] group focus-ring"
    >
      <div
        style={{ backgroundColor: item.dominant_color || "#D4CDC3" }}
        className="overflow-hidden aspect-[3/4]"
      >
        <img
          src={item.imageUrl}
          loading="lazy"
          decoding="async"
          alt={buildArtworkAltText(item)}
          width={400}
          height={533}
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          style={{ objectPosition: focalObjectPosition(item.focal_x, item.focal_y) }}
        />
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-[#F5F0E8] leading-snug line-clamp-2">
          {item.title_sv || "Utan titel"}
        </p>
        <p className="text-xs text-[rgba(245,240,232,0.55)] mt-1">{artworkArtist(item)}</p>
        {showMuseumBadge && item.museum_name && (
          <p className="text-[0.65rem] text-[rgba(245,240,232,0.55)] mt-0.5">{item.museum_name}</p>
        )}
        {yearLabel && <p className="text-xs text-[rgba(245,240,232,0.4)] mt-0.5">{yearLabel}</p>}
      </div>
    </a>
  );
});

export default function ArtworkCard(props: ArtworkCardProps) {
  if (props.layout === "search") {
    return <SearchArtworkCard {...props} />;
  }

  const feedProps: FeedLayoutProps = {
    layout: "feed",
    item: props.item,
    showMuseumBadge: props.showMuseumBadge,
    index: props.index,
    variant: props.variant,
  };

  return <FeedArtworkCard {...feedProps} />;
}

