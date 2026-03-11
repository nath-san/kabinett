import type { ThemeCardSection } from "../components/ThemeCard";
import type { CampaignId } from "./campaign.server";

// Universal themes that work well across all collections
const UNIVERSAL_THEMES: ThemeCardSection[] = [
  { title: "Porträtt", subtitle: "Ansikten genom tiderna", filter: "Porträtt", color: "#2E2620", items: [] },
  { title: "I rött", subtitle: "Passion och drama", filter: "Rött", color: "#3A1A1A", items: [] },
  { title: "Djur i konsten", subtitle: "Från hästar till hundar", filter: "Djur", color: "#2D3A2D", items: [] },
  { title: "Blommor", subtitle: "Natur i närbild", filter: "Blommor", color: "#2A2D1A", items: [] },
  { title: "I blått", subtitle: "Melankoli och hav", filter: "Blått", color: "#1A1A2E", items: [] },
];

// Campaign-specific highlight themes (strong visual results per collection)
const NM_THEMES: ThemeCardSection[] = [
  { title: "Havslandskap", subtitle: "Vatten, kust och hav", filter: "Havet", color: "#1A2A3A", items: [] },
  { title: "Nattscener", subtitle: "Mörker och mystik", filter: "Natt", color: "#0F0F1A", items: [] },
  { title: "Skulptur", subtitle: "Form i tre dimensioner", filter: "Skulptur", color: "#222222", items: [] },
  { title: "1800-talet", subtitle: "Romantik och realism", filter: "1800-tal", color: "#2A2520", items: [] },
  { title: "1700-talet", subtitle: "Rokoko och upplysning", filter: "1700-tal", color: "#28261E", items: [] },
];

const NORDISKA_THEMES: ThemeCardSection[] = [
  { title: "Folkdräkter", subtitle: "Traditioner i tyg", filter: "Folkdräkt", color: "#2A1F1A", items: [] },
  { title: "Stockholm i svartvitt", subtitle: "Huvudstaden genom kameran", filter: "Stockholm svartvitt", color: "#1A1D24", items: [] },
  { title: "Vintermotiv", subtitle: "Snö, is och kyla", filter: "Vinter snö", color: "#1E2530", items: [] },
  { title: "Barndom", subtitle: "Lek och vardag", filter: "Barn leker", color: "#2D2A1A", items: [] },
  { title: "Mode", subtitle: "Från NK till haute couture", filter: "Mode klänning", color: "#2A1A2A", items: [] },
];

const SHM_THEMES: ThemeCardSection[] = [
  { title: "Guld och silver", subtitle: "Skatter och smycken", filter: "Guld silver smycke", color: "#2A2518", items: [] },
  { title: "Runstenar", subtitle: "Berättelser i sten", filter: "Runsten", color: "#1C1E1A", items: [] },
  { title: "Rustningar", subtitle: "Från tornerspel till krig", filter: "Rustning harnesk", color: "#1F1A14", items: [] },
  { title: "Kungligt", subtitle: "Kronor, tronföljd och makt", filter: "Kung krona kunglig", color: "#28201A", items: [] },
  { title: "Medeltid", subtitle: "Tro, makt och hantverk", filter: "Medeltid kyrka", color: "#1E1E20", items: [] },
];

// Max 5 themes per campaign — universal first, then highlights to fill
const MAX_THEMES = 5;

const CAMPAIGN_THEMES: Record<CampaignId, ThemeCardSection[]> = {
  default: [...UNIVERSAL_THEMES.slice(0, 2), ...NM_THEMES.slice(0, 3)],
  nationalmuseum: [...UNIVERSAL_THEMES.slice(0, 2), ...NM_THEMES.slice(0, 3)],
  nordiska: [...UNIVERSAL_THEMES.slice(0, 2), ...NORDISKA_THEMES.slice(0, 3)],
  shm: [...UNIVERSAL_THEMES.slice(0, 2), ...SHM_THEMES.slice(0, 3)],
};

/** @deprecated Use getThemes(campaignId) instead */
export const THEMES = CAMPAIGN_THEMES.default;

export function getThemes(campaignId: CampaignId = "default"): ThemeCardSection[] {
  return CAMPAIGN_THEMES[campaignId] || CAMPAIGN_THEMES.default;
}
