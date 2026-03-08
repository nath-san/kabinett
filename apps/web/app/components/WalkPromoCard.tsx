export default function WalkPromoCard() {
  return (
    <section className="bg-dark-raised rounded-none lg:rounded-section px-5 py-8 md:px-7 md:py-9 lg:px-10 lg:py-10">
      <p className="font-serif text-[1.7rem] md:text-[1.9rem] text-dark-text leading-[1.1]">
        Upptäck konstvandringar
      </p>
      <p className="mt-2 text-[0.8rem] text-dark-text-secondary">
        Utvalda resor genom samlingarna
      </p>
      <a href="/walks" className="inline-block mt-5 text-[0.7rem] tracking-[0.1em] uppercase text-dark-text-secondary hover:text-dark-text transition-colors no-underline focus-ring">
        Till vandringarna →
      </a>
    </section>
  );
}

