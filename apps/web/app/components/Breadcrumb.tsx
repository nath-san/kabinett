type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbProps = {
  items: BreadcrumbItem[];
  variant?: "light" | "dark";
  className?: string;
};

export default function Breadcrumb({ items, variant = "light", className = "" }: BreadcrumbProps) {
  const mutedColor = variant === "dark" ? "text-[rgba(255,255,255,0.5)]" : "text-warm-gray";
  const currentColor = variant === "dark" ? "text-[rgba(255,255,255,0.85)]" : "text-charcoal";

  return (
    <nav aria-label="Breadcrumb" className={`text-[0.8rem] ${className}`}>
      <ol className="flex items-center gap-1 min-w-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1 min-w-0">
              {isLast ? (
                <span
                  aria-current="page"
                  className={`block max-w-[18.75rem] truncate ${currentColor}`}
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  className={`${mutedColor} no-underline hover:opacity-80 focus-ring whitespace-nowrap`}
                >
                  {item.label}
                </a>
              ) : (
                <span className={`${mutedColor} whitespace-nowrap`}>{item.label}</span>
              )}
              {!isLast && <span className={mutedColor}>›</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
