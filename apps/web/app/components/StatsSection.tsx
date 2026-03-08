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
    <div className="py-14 md:py-18 lg:py-24 px-6 md:px-8 bg-[linear-gradient(135deg,#1A1815_0%,#252019_100%)] text-center lg:rounded-section">
      <p className="text-[0.6rem] font-semibold tracking-[0.22em] uppercase text-[rgba(255,255,255,0.3)]">
        Sveriges kulturarv
      </p>
      <h2 className="font-serif text-[1.8rem] md:text-[2.2rem] lg:text-[2.5rem] text-dark-text mt-2.5 mb-8 md:mb-10 leading-[1.1]">
        Samlingen i siffror
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-6 gap-x-4 lg:gap-x-10 lg:gap-y-8 max-w-[18rem] md:max-w-[32rem] lg:max-w-4xl mx-auto">
        {items.map((item) => (
          <div key={item.label}>
            <p className="font-serif text-[1.5rem] md:text-[1.8rem] lg:text-[2.4rem] font-semibold text-dark-text m-0 leading-none">
              {item.value}
            </p>
            <p className="text-[0.58rem] md:text-[0.62rem] lg:text-[0.68rem] text-dark-text-muted mt-1.5 uppercase tracking-[0.1em]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <a
        href="/discover"
        className="inline-block mt-8 md:mt-10 py-[0.55rem] px-5 rounded-full border border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.55)] text-[0.75rem] font-medium no-underline tracking-[0.03em] hover:border-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.9)] transition-colors focus-ring"
      >
        Upptäck samlingen →
      </a>
    </div>
  );
}

