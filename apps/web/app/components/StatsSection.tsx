import { useScrollReveal } from "../hooks/useScrollReveal";

export type StatsCardData = {
  total: number;
  museums: number;
  paintings: number;
  yearsSpan: number;
};

export default function StatsSection({ stats, museumName }: { stats: StatsCardData; museumName?: string | null }) {
  const ref = useScrollReveal<HTMLDivElement>();
  const items = [
    { value: stats.total.toLocaleString("sv"), label: "verk" },
    ...(stats.museums > 1 ? [{ value: stats.museums.toLocaleString("sv"), label: "samlingar" }] : []),
    { value: `${stats.yearsSpan} år`, label: "av historia" },
    { value: stats.paintings.toLocaleString("sv"), label: "målningar" },
  ];
  return (
    <div
      ref={ref}
      className="relative py-16 md:py-20 lg:py-28 px-6 md:px-8 bg-[linear-gradient(145deg,#141210_0%,#1A1714_40%,#221E18_100%)] text-center lg:rounded-section overflow-hidden"
    >
      <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,rgba(212,168,83,0.06),transparent)] pointer-events-none" />
      <p className="text-[0.58rem] font-medium tracking-[0.24em] uppercase text-[rgba(255,255,255,0.25)] relative">
        {museumName || "Sveriges kulturarv"}
      </p>
      <h2 className="font-serif text-[1.8rem] md:text-[2.2rem] lg:text-[2.5rem] text-dark-text mt-3 mb-10 md:mb-12 leading-[1.1] relative">
        Samlingen i siffror
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-4 lg:gap-x-12 lg:gap-y-8 max-w-[18rem] md:max-w-[34rem] lg:max-w-4xl mx-auto relative">
        {items.map((item, i) => (
          <div key={item.label} className="reveal-on-scroll" style={{ transitionDelay: `${i * 100}ms` }}>
            <p
              className="font-serif text-[1.5rem] md:text-[1.8rem] lg:text-[2.4rem] font-semibold text-dark-text m-0 leading-none"
              style={{
                animation: "countUp 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) both",
                animationDelay: `${i * 120}ms`,
              }}
            >
              {item.value}
            </p>
            <p className="text-[0.56rem] md:text-[0.60rem] lg:text-[0.66rem] text-dark-text-muted mt-2 uppercase tracking-[0.12em]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <a
        href="/discover"
        className="relative inline-block mt-10 md:mt-12 py-[0.55rem] px-5 rounded-full border border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.50)] text-[0.75rem] font-medium no-underline tracking-[0.03em] hover:border-[rgba(212,168,83,0.35)] hover:text-[rgba(255,255,255,0.85)] hover:shadow-[0_0_24px_rgba(212,168,83,0.08)] transition-[color,border-color,box-shadow] duration-300 focus-ring"
      >
        Upptäck samlingen →
      </a>
    </div>
  );
}
