import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "kabinett-favorites";

function readRaw(): string {
  if (typeof window === "undefined") return "[]";
  return window.localStorage.getItem(STORAGE_KEY) || "[]";
}

function parseIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  } catch {
    return [];
  }
}

export function getFavoriteIds(): number[] {
  return parseIds(readRaw());
}

function writeIds(ids: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent("kabinett-favorites"));
}

export function toggleFavorite(id: number): number[] {
  const ids = getFavoriteIds();
  const next = ids.includes(id) ? ids.filter((item) => item !== id) : [id, ...ids];
  writeIds(next);
  return next;
}

export function removeFavorite(id: number): number[] {
  const ids = getFavoriteIds();
  const next = ids.filter((item) => item !== id);
  writeIds(next);
  return next;
}

function subscribe(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("kabinett-favorites", listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("kabinett-favorites", listener);
  };
}

export function useFavorites() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const ids = useMemo(() => parseIds(raw), [raw]);

  return {
    ids,
    count: ids.length,
    isFavorite: (id: number) => ids.includes(id),
    toggle: (id: number) => toggleFavorite(id),
    remove: (id: number) => removeFavorite(id),
  };
}
