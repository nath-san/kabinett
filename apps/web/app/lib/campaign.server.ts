import { getRequestContext } from "./request-context.server";

export type CampaignId = "default" | "europeana" | "nationalmuseum" | "nordiska" | "shm";

export type CampaignConfig = {
  id: CampaignId;
  museums: string[] | null;
  museumId: string | null;
  museumName: string | null;
  heroSubline: string;
  heroIntro: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
};

type CampaignBase = Omit<CampaignConfig, "id">;

const DEFAULT_HERO_SUBLINE = "Sök på vad som helst.";

const CAMPAIGNS: Record<CampaignId, CampaignBase> = {
  default: {
    museums: null,
    museumId: null,
    museumName: null,
    heroSubline: DEFAULT_HERO_SUBLINE,
    heroIntro: null,
    metaTitle: null,
    metaDescription: null,
    noindex: false,
  },
  europeana: {
    museums: ["europeana"],
    museumId: "europeana",
    museumName: "Europeana",
    heroSubline: "100 000 European artworks. Search in any language.",
    heroIntro: "Paintings, sculptures, prints and photographs from Europe's greatest museums — searchable with AI.",
    metaTitle: "Kabinett × Europeana",
    metaDescription: null,
    noindex: true,
  },
  nationalmuseum: {
    museums: ["nationalmuseum"],
    museumId: "nationalmuseum",
    museumName: "Nationalmuseum",
    heroSubline: "74 000 verk. Sök med egna ord.",
    heroIntro:
      "Måleri, skulptur, grafik och konsthantverk från Nationalmuseums samling — samlat och sökbart på ett nytt sätt.",
    metaTitle: "Kabinett × Nationalmuseum",
    metaDescription:
      "Utforska 74 000 verk ur Nationalmuseums samling. Måleri, skulptur, grafik och konsthantverk — sökbart med egna ord.",
    noindex: true,
  },
  nordiska: {
    museums: ["nordiska"],
    museumId: "nordiska",
    museumName: "Nordiska museet",
    heroSubline: "286 000 föremål. Sök med egna ord.",
    heroIntro:
      "Allmogemöbler, dräkter, leksaker och vardagsliv från fem sekler — hela Nordiska museets samling, sökbar med egna ord.",
    metaTitle: "Kabinett × Nordiska museet",
    metaDescription:
      "Utforska 286 000 föremål ur Nordiska museets samling. Kulturhistoria från fem sekler, sökbar med egna ord.",
    noindex: true,
  },
  shm: {
    museums: ["shm"],
    museumId: "shm",
    museumName: "Statens historiska museer",
    heroSubline: "799 000 objekt från 7 samlingar. Sök med egna ord.",
    heroIntro:
      "Från vikingasvärden på Historiska till Hallwylska palatsets silversamling — sju museers samlingar, sökbara på ett ställe.",
    metaTitle: "Kabinett × Statens historiska museer",
    metaDescription:
      "Utforska 799 000 objekt från Livrustkammaren, Hallwylska, Historiska och fler — sju samlingar, sökbara med egna ord.",
    noindex: true,
  },
};

const ALIASES: Record<string, CampaignId> = {
  default: "default",
  multi: "default",
  all: "default",
  europeana: "europeana",
  nm: "nationalmuseum",
  nationalmuseum: "nationalmuseum",
  nordiska: "nordiska",
  shm: "shm",
};

const HOSTNAME_MAP: Record<string, CampaignId> = {
  "europeana.norrava.com": "europeana",
  "nm.norrava.com": "nationalmuseum",
  "nationalmuseum.norrava.com": "nationalmuseum",
  "nordiska.norrava.com": "nordiska",
  "shm.norrava.com": "shm",
};

function normalizeHost(host: string | null): string | null {
  const raw = host?.trim().toLowerCase();
  if (!raw) return null;

  try {
    return new URL(`http://${raw}`).hostname.replace(/\.+$/, "");
  } catch {
    return raw.replace(/:\d+$/, "").replace(/\.+$/, "");
  }
}

function parseCampaignId(value: string | undefined): CampaignId {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "default";
  return ALIASES[normalized] || "default";
}

function toCampaignConfig(id: CampaignId): CampaignConfig {
  return { id, ...CAMPAIGNS[id] };
}

export function resolveCampaignFromHost(host: string | null): CampaignConfig {
  const normalizedHost = normalizeHost(host);
  const id = normalizedHost ? HOSTNAME_MAP[normalizedHost] || "default" : "default";
  return toCampaignConfig(id);
}

export function getCampaignConfig(): CampaignConfig {
  const context = getRequestContext();
  if (context) {
    return toCampaignConfig(context.campaignId);
  }

  const id = parseCampaignId(process.env.KABINETT_CAMPAIGN);
  return toCampaignConfig(id);
}
