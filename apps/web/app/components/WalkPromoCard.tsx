export default function WalkPromoCard() {
  return (
    <section className="bg-[#2B2A27] rounded-none lg:rounded-[1.5rem] px-6 py-8 md:px-8 md:py-9 lg:px-10 lg:py-10">
      <p className="font-serif text-[1.9rem] md:text-[2.2rem] text-[#F5F0E8] leading-[1.1]">
        Upptäck konstvandringar
      </p>
      <p className="mt-2 text-[0.85rem] text-[rgba(245,240,232,0.65)]">
        Utvalda resor genom samlingarna
      </p>
      <a href="/walks" className="inline-block mt-5 text-[0.76rem] tracking-[0.08em] uppercase text-[rgba(245,240,232,0.8)] no-underline focus-ring">
        Till vandringarna →
      </a>
    </section>
  );
}

