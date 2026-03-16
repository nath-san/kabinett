type GridCardItem = {
  id: number | string;
  title: string;
  artist?: string;
  year?: string;
  imageUrl: string;
  color: string;
  focal_x?: number | null;
  focal_y?: number | null;
};

type GridCardProps = {
  item: GridCardItem;
  variant?: "light" | "dark";
};

export type { GridCardItem };

export default function GridCard({ item, variant = "light" }: GridCardProps) {
  const bgClass = variant === "dark" ? "bg-dark-raised" : "bg-linen";
  const titleColor = variant === "dark" ? "text-dark-text" : "text-charcoal";
  const secondaryColor = variant === "dark" ? "text-dark-text-secondary" : "text-warm-gray";
  const focalPos = `${(item.focal_x ?? 0.5) * 100}% ${(item.focal_y ?? 0.5) * 100}%`;

  return (
    <a
      href={`/artwork/${item.id}`}
      className={`art-card break-inside-avoid block rounded-card overflow-hidden ${bgClass} mb-3 no-underline group focus-ring`}
    >
      <div
        className="aspect-[3/4] overflow-hidden"
        style={{ backgroundColor: item.color }}
      >
        <img
          src={item.imageUrl}
          alt={item.artist ? `${item.title} — ${item.artist}` : item.title}
          width={400}
          height={533}
          loading="lazy"
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
          className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-400"
          style={{
            objectPosition: focalPos,
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>
      <div className="p-3">
        <p className={`text-sm font-medium ${titleColor} leading-snug line-clamp-2 min-h-[2.25rem]`}>
          {item.title}
        </p>
        {(item.artist || item.year) && (
          <p className={`text-xs ${secondaryColor} mt-1 leading-snug line-clamp-1`}>
            {item.artist}
            {item.artist && item.year ? " · " : ""}
            {item.year}
          </p>
        )}
      </div>
    </a>
  );
}
