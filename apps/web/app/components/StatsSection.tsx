export type StatsCardData = {
  total: number;
  museums: number;
  paintings: number;
  yearsSpan: number;
};

export default function StatsSection({ stats }: { stats: StatsCardData }) {
  const items = [
    { value: stats.total.toLocaleString("sv"), label: "verk" },
    { value: stats.museums.toLocaleString("sv"), label: "samlingar" },
    { value: `${stats.yearsSpan} år`, label: "av historia" },
    { value: stats.paintings.toLocaleString("sv"), label: "målningar" },
  ];
  return (
    <div className="py-12 md:py-16 lg:py-20 px-6 md:px-8 bg-[linear-gradient(135deg,#1A1815_0%,#2B2520_100%)] text-center lg:rounded-section">
      <p className="text-[0.65rem] font-semibold tracking-[0.2em] uppercase text-[rgba(255,255,255,0.35)]">
        Sveriges kulturarv
      </p>
      <h2 className="font-serif text-[2rem] lg:text-[2.6rem] text-dark-text mt-2 mb-6 leading-[1.1]">
        Samlingen i siffror
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-4 lg:gap-x-8 lg:gap-y-6 max-w-[18rem] md:max-w-[30rem] lg:max-w-5xl mx-auto">
        {items.map((item) => (
          <div key={item.label}>
            <p className="font-serif text-[1.6rem] md:text-[2rem] lg:text-[2.7rem] font-semibold text-dark-text m-0 leading-none">
              {item.value}
            </p>
            <p className="text-[0.6rem] md:text-[0.65rem] lg:text-[0.7rem] text-dark-text-muted mt-1 uppercase tracking-[0.08em]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <a
        href="/discover"
        className="inline-block mt-6 py-[0.6rem] px-6 rounded-full border border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.7)] text-[0.78rem] font-medium no-underline tracking-[0.02em] hover:border-[rgba(255,255,255,0.35)] hover:text-white transition-colors focus-ring"
      >
        Upptäck samlingen →
      </a>
    </div>
  );
}

