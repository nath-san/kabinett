import type { CampaignId } from "../lib/campaign.server";

const COPY_BY_CAMPAIGN: Record<CampaignId, { eyebrow: string; title: string; body: string; cta: string }> = {
  default: {
    eyebrow: "Nytt",
    title: "Upptäck konstvandringar",
    body: "Utvalda resor genom samlingarna — med berättelser och utvalda verk.",
    cta: "Till vandringarna →",
  },
  europeana: {
    eyebrow: "Nytt",
    title: "Upptäck konstvandringar",
    body: "Utvalda resor genom samlingarna — med berättelser och utvalda verk.",
    cta: "Till vandringarna →",
  },
  nationalmuseum: {
    eyebrow: "Nytt",
    title: "Upptäck konstvandringar",
    body: "Utvalda resor genom samlingarna — med berättelser och utvalda verk.",
    cta: "Till vandringarna →",
  },
  nordiska: {
    eyebrow: "Förslag & vandringar",
    title: "Följ samiska spår",
    body: "Fördjupa dig i samiska verk och andra tematiska urval från Nordiska museet.",
    cta: "Se förslag och vandringar →",
  },
  shm: {
    eyebrow: "Nytt",
    title: "Upptäck konstvandringar",
    body: "Utvalda resor genom samlingarna — med berättelser och utvalda verk.",
    cta: "Till vandringarna →",
  },
};

export default function WalkPromoCard({ campaignId = "default" }: { campaignId?: CampaignId }) {
  const copy = COPY_BY_CAMPAIGN[campaignId] || COPY_BY_CAMPAIGN.default;

  return (
    <section className="reveal-on-scroll relative bg-dark-raised rounded-none lg:rounded-section px-5 py-9 md:px-7 md:py-10 lg:px-10 lg:py-12 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(ellipse_70%_100%_at_50%_0%,rgba(212,168,83,0.04),transparent)] pointer-events-none" />
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-gold/40 font-medium relative">{copy.eyebrow}</p>
      <p className="font-serif text-[1.7rem] md:text-[1.9rem] text-dark-text leading-[1.1] mt-2 relative">
        {copy.title}
      </p>
      <p className="mt-2.5 text-[0.82rem] text-dark-text-secondary leading-[1.5] relative">
        {copy.body}
      </p>
      <a
        href="/vandringar"
        className="inline-flex items-center gap-1 mt-5 text-[0.72rem] tracking-[0.08em] uppercase text-dark-text-secondary hover:text-gold transition-colors no-underline focus-ring relative group/link"
      >
        {copy.cta.replace(" →", "")}
        <span className="inline-block transition-transform duration-300 group-hover/link:translate-x-1" style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}> →</span>
      </a>
    </section>
  );
}
