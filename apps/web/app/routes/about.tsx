import type { Route } from "./+types/about";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Om — Kabinett" },
    { name: "description", content: "Om Kabinett." },
  ];
}

export default function About() {
  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4 max-w-xl">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Om Kabinett</h1>
        <div className="mt-6 space-y-4 text-charcoal/80 text-sm leading-relaxed">
          <p>
            Kabinett är ett experiment i att göra museisamlingar tillgängliga på ett nytt sätt.
            Istället för katalogsökning — upptäck. Istället för inventarienummer — nyfikenhet.
          </p>
          <p>
            All data kommer från Nationalmuseums öppna API. Metadata är CC0, bilder är Public Domain.
          </p>
          <p className="text-warm-gray text-xs pt-4">
            Kabinett är inte affilierat med Nationalmuseum.
          </p>
        </div>
      </div>
    </div>
  );
}
