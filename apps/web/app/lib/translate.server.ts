const cache = new Map<string, string>();

/**
 * Translate text from Swedish to English using Google Translate's
 * free endpoint. Results are cached in memory.
 * Falls back to original text on failure.
 */
export async function translateToEnglish(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;



  const cached = cache.get(trimmed);
  if (cached) return cached;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=sv&tl=en&dt=t&q=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Response format: [[["translated","original",...],...]...]
    const translated = data?.[0]?.map((seg: any) => seg[0]).join("") || trimmed;
    cache.set(trimmed, translated);
    // Keep cache bounded
    if (cache.size > 5000) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return translated;
  } catch (err) {
    console.error("[Translate error]", err);
    return trimmed;
  }
}
