/**
 * store/listingsStore.ts
 * Pure helpers — load / save / sanitize / merge listings.
 * No React, no side-effects. Consumed by hooks & components.
 */
import { DISTRICT_CENTRES } from '@/lib/ugandaData';
import { learner, computeQualityScore } from '@/lib/learningEngine';
import type { Listing, UnverifiedLocation } from '@/types';

// ── localStorage helpers ────────────────────────────────────────────
export function safeJSON<T>(s: string, def: T): T {
  try { return JSON.parse(s) as T; } catch { return def; }
}
export function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function lsSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* quota full */ }
}

// ── sanitize raw JSON → Listing ─────────────────────────────────────
function toNum(v: unknown, fb = 0): number {
  const n = Number(v); return isFinite(n) ? n : fb;
}

export function sanitizeListing(raw: Record<string, unknown>): Listing | null {
  if (!raw || typeof raw !== 'object') return null;
  const areaName = String(raw.areaName || 'Gulu');
  const centre   = DISTRICT_CENTRES[areaName] || DISTRICT_CENTRES['Gulu'];
  const price    = toNum(raw.priceUGX, 0);
  return {
    id:       toNum(raw.id, Date.now() + Math.random()),
    title:    String(raw.title   || 'Untitled Property'),
    priceUGX: price > 0 ? price : 1,
    areaName,
    suburb:   String(raw.suburb  || ''),
    status:   (['sold','unsold'].includes(String(raw.status))
                ? raw.status : 'unsold') as 'sold' | 'unsold',
    interest: (['high','medium','low'].includes(String(raw.interest))
                ? raw.interest : 'medium') as 'high' | 'medium' | 'low',
    size:     String(raw.size    || 'unknown'),
    lat:      toNum(raw.lat,  centre.lat),
    lng:      toNum(raw.lng,  centre.lng),
    posts:    toNum(raw.posts, 1),
    agent:    String(raw.agent   || ''),
    contact:  String(raw.contact || ''),
    notes:    String(raw.notes   || ''),
    village:  String(raw.village || ''),
    district: String(raw.district || raw.areaName || 'Gulu'),
    _geocoded:      Boolean(raw._geocoded),
    _geocodeSource: (raw._geocodeSource as 'osm' | 'local' | 'fallback') || 'fallback',
  };
}

// ── persistence ──────────────────────────────────────────────────────
export const PERSIST_KEY = 'ug_persist_v5';

export function loadListings(): Listing[] {
  const saved = lsGet(PERSIST_KEY);
  if (!saved) return [];
  const arr = safeJSON<unknown[]>(saved, []);
  const cleaned = (Array.isArray(arr) ? arr : [])
    .map(x => sanitizeListing(x as Record<string, unknown>))
    .filter(Boolean) as Listing[];
  cleaned.forEach(l => learner.learn(l, computeQualityScore(l)));
  return cleaned;
}

export function saveListings(ls: Listing[]): void {
  lsSet(PERSIST_KEY, JSON.stringify(ls));
}

// ── dedup merge ──────────────────────────────────────────────────────
export function mergeOrAdd(prev: Listing[], incoming: Listing): Listing[] {
  const c = sanitizeListing(incoming as unknown as Record<string, unknown>);
  if (!c) return prev;

  const dup = prev.findIndex(l =>
    l.areaName === c.areaName &&
    l.size     === c.size &&
    Math.abs(l.priceUGX - c.priceUGX) < 10
  );

  if (dup !== -1) {
    const next = [...prev];
    const ex   = next[dup];
    const centre = DISTRICT_CENTRES[c.areaName] || DISTRICT_CENTRES['Gulu'];
    next[dup] = {
      ...ex,
      posts:   (ex.posts || 1) + 1,
      lat:     (c.lat && Math.abs(c.lat - centre.lat) > 0.0001) ? c.lat : ex.lat,
      lng:     (c.lng && Math.abs(c.lng - centre.lng) > 0.0001) ? c.lng : ex.lng,
      village: c.village || ex.village,
    };
    learner.learn(next[dup], computeQualityScore(next[dup]));
    return next;
  }
  learner.learn(c, computeQualityScore(c));
  return [c, ...prev];
}

export type { UnverifiedLocation };
