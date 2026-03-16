import type { CampaignId } from "../lib/campaign.server";

const COPY_BY_CAMPAIGN: Record<CampaignId, { eyebrow: string; title: string; body: string; cta: string }> = {
  default: {
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
    <section className="bg-dark-raised rounded-none lg:rounded-section px-5 py-9 md:px-7 md:py-10 lg:px-10 lg:py-12">
      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-dark-text-muted font-medium">{copy.eyebrow}</p>
      <p className="font-serif text-[1.7rem] md:text-[1.9rem] text-dark-text leading-[1.1] mt-2">
        {copy.title}
      </p>
      <p className="mt-2.5 text-[0.82rem] text-dark-text-secondary leading-[1.5]">
        {copy.body}
      </p>
      <a href="/vandringar" className="inline-block mt-5 text-[0.72rem] tracking-[0.08em] uppercase text-dark-text-secondary hover:text-dark-text transition-colors no-underline focus-ring">
        {copy.cta}
      </a>
    </section>
  );
}
