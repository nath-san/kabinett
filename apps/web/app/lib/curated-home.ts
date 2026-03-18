import type { CampaignId } from "./campaign.server";

// Hand-curated artwork IDs for the home page hero feed.

// NM — paintings, sculpture, drawings, prints
const CURATED_NM: number[] = [
  22307, 17771, 24264, 19686, 18193, 19760, 17271, 19011, 159709, 18509,
  16710, 16706, 23434, 14830, 18911, 40127, 17924, 15666, 19042, 20897,
  15482, 210393, 21900, 21515, 19582, 244887, 22838, 174865, 23021, 18737,
  15027, 17721, 18160, 15618, 24018, 97310, 17289, 17615, 218370, 17897,
  24212, 216473, 21072, 22346, 17650, 20356, 18781, 218091, 15567, 20110,
  23227, 242221, 17064, 22465, 212133, 19253, 16032, 14691, 19156, 19064,
  243377, 183319, 183078, 143693, 74492, 140906, 243803, 49935, 48146, 231884,
  148448, 147469, 67761, 70759, 159970, 82726, 209345, 47759, 218263, 57439,
];

// Nordiska museet — photography, fashion, interiors, cultural history
const CURATED_NORDISKA: number[] = [
  -280638127179320, // Strindberg självporträtt "rysk nihilist"
  -75744189846311,  // Modevisning, Dior
  -201591440062435, // Kungabröllopet 1976
  -124678142723,    // Vanadisbadet, tre flickor
  -167292648784612, // Delsbogården interiör, Skansen
  -62183524785447,  // Rosengården, Julita gård
  -83294003099154,  // Man läser tidning, Stadshuset i bakgrunden
  -263988405046017, // Svanar vid Strömkajen, vinter
  -240963163717680, // Högbergsgatan, Södermalm
  -238332025309837, // Stockholm, utsikt från Västerbron
  -151745875550768, // Samisk expedition, Lappland 1868
  -146575504581717, // Berlinblockaden, flygfält
  -13275750337023,  // Ivar Lo-Johansson & Harry Martinson
  -54301021856869,  // Kvinna i fjällandskap, Åre
  -3696998979892,   // Samiska barn, Gällivare
  -271083248481135, // Man provar hatt på kvinna
  -192287124046480, // Modeller, Nordiska Kompaniet
  -137046143949082, // K W Gullers äter frukost, Istanbul
  -105201313275825, // Ung kvinna på skidor
  -231201304491194, // Flicka barbacka på häst
];

// SHM — armour, crowns, carriages, sculpture, decorative arts
const CURATED_SHM: number[] = [
  -281416342244544, // Gustav II Adolfs tornerrustning
  -281304134560360, // "En Wildes Klädning", Dianas fest 1778
  -281238685453888, // Kronprinsessan Margaretas krona
  -281207303109992, // Hovvagn, sjuglasvagn
  -281181493883421, // Jaktvagn, oval vagnskorg
  -281042951176972, // Sigismund Augusts sadel, Nürnberg 1550-tal
  -280854102764253, // Bronsskulptur på piedestal, Hallwylska
  -278375852999594, // Vas, Qingdynastin, Hallwylska
  -277707230609397, // Takmålning, Perseus befriar Andromeda
  -277688745699631, // Skulptur, Elisabeth av Ryssland till häst
  -246162473795270, // Halvrustning, polsk typ, 1600-tal
  -281474603298298, // Dosformigt spänne, Historiska
  -281384546973021, // Hörnknoppssvärd, Historiska
  -281364028501411, // Tveeggat svärd, Historiska
  -281186847678213, // Djurhuvudformat spänne, Historiska
  -255473293795734, // Ryttaryxa, Tyskland 1500-tal
  -15825045791516,  // Flintlåspistol, Paris 1670
  -280746787501651, // Sabel, typ karabela, Polen
  -128465658375011, // Skåp, renässans, Hallwylska
  -130479735605249, // Klockspelet i Tyska Kyrkan, Hallwylska
];

// Default — mix of all museums (same as NM for backward compat)
const CURATED_DEFAULT = CURATED_NM;

const CURATED_BY_CAMPAIGN: Record<CampaignId, number[]> = {
  default: CURATED_DEFAULT,
  europeana: CURATED_DEFAULT,
  nationalmuseum: CURATED_NM,
  nordiska: CURATED_NORDISKA,
  shm: CURATED_SHM,
};

export function getCuratedIds(campaignId: CampaignId = "default"): number[] {
  return CURATED_BY_CAMPAIGN[campaignId] ?? CURATED_DEFAULT;
}

/** @deprecated Use getCuratedIds() instead */
export const CURATED_IDS = CURATED_DEFAULT;
