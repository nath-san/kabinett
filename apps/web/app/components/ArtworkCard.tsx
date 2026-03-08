import React, { useState } from "react";
import { useFavorites } from "../lib/favorites";
import { buildImageUrl } from "../lib/images";
import type { MatchType } from "../lib/search-types";
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
  snippet?: string | null;
  matchType?: MatchType;
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
    ? "lg:col-span-2 lg:aspect-[3/2] lg:max-h-[34rem]"
    : variant === "medium"
      ? "lg:col-span-2 lg:aspect-[5/2] lg:max-h-[22rem]"
      : "lg:col-span-1 lg:aspect-[3/4] lg:max-h-[34rem]";

  const mobileHeight = variant === "large"
    ? "h-[48vh] md:h-[65vh]"
    : variant === "medium"
      ? "h-[38vh] md:h-[42vh]"
      : "h-[42vh] md:h-[50vh]";

  return (
    <a
      href={`/artwork/${item.id}`}
      className={`block relative w-full ${mobileHeight} lg:h-auto no-underline text-inherit overflow-hidden contain-[layout_paint] md:rounded-card group/card focus-ring ${variantClass}`}
      style={{ backgroundColor: item.dominant_color || "#1A1815" }}
    >
      <img
        src={item.imageUrl}
        srcSet={item.iiif_url ? `${buildImageUrl(item.iiif_url, 400)} 400w, ${buildImageUrl(item.iiif_url, 800)} 800w` : undefined}
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
          "absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out lg:group-hover/card:scale-[1.02]",
          eager ? "" : "opacity-0 lg:opacity-100",
        ].join(" ")}
        style={{ objectPosition: focalObjectPosition(item.focal_x, item.focal_y) }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.3)_28%,transparent_50%)] pointer-events-none lg:opacity-60 lg:group-hover/card:opacity-100 lg:transition-opacity lg:duration-500" />
      <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6 lg:p-7" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.5), 0 0 12px rgba(0,0,0,0.25)" }}>
        <p className="font-serif text-[1.3rem] md:text-[1.4rem] lg:text-[1.55rem] font-semibold text-white leading-[1.15] mb-[0.3rem] line-clamp-2">
          {item.title_sv || "Utan titel"}
        </p>
        <p className="text-[0.8rem] lg:text-[0.85rem] text-[rgba(255,255,255,0.7)]">
          {artworkArtist(item)}
        </p>
        {showMuseumBadge && item.museum_name && (
          <p className="text-[0.7rem] lg:text-[0.75rem] text-[rgba(255,255,255,0.4)] mt-[0.15rem]">
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
  snippet,
  matchType,
}: SearchLayoutProps) {
  return (
    <a
      href={`/artwork/${item.id}`}
      className="art-card block break-inside-avoid rounded-card overflow-hidden bg-dark-raised group focus-ring"
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
        <p className="text-sm font-medium text-dark-text leading-snug line-clamp-2">
          {item.title_sv || "Utan titel"}
        </p>
        <p className="text-xs text-dark-text-secondary mt-1">{artworkArtist(item)}</p>
        {showMuseumBadge && item.museum_name && (
          <p className="text-[0.65rem] text-dark-text-secondary mt-0.5">{item.museum_name}</p>
        )}
        {yearLabel && <p className="text-xs text-dark-text-muted mt-0.5">{yearLabel}</p>}
        {snippet && (
          <p className="text-[0.7rem] text-dark-text-muted mt-1 line-clamp-2 italic">{snippet}</p>
        )}

      </div>
    </a>
  );
});

export default function ArtworkCard(props: ArtworkCardProps) {
  if (props.layout === "search") {
    return <SearchArtworkCard {...props} />;
  }
  return <FeedArtworkCard {...props} />;
}

