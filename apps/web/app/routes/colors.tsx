import type { Route } from "./+types/colors";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

export default function Colors() {
  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Färger</h1>
        <p className="text-warm-gray text-sm mt-1">Kommer snart — utforska samlingen efter dominant färg.</p>
      </div>
    </div>
  );
}
