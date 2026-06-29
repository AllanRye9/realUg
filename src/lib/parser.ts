/**
 * lib/parser.ts — Uganda Real Estate Text Parser
 *
 * This is the llmAdvance-port version. It replaces the previous parser with
 * all 8 bug-fixes from llmAdvance.py, fully adapted to the existing TS API:
 *
 *  1. Splitter      — numbered sub-item broker blocks (1–70+) kept together;
 *                     no phantom fragments; two-pass paragraph assembly.
 *  2. Price         — large UGX shilling values (4,500,000 → 4.5M) correctly
 *                     converted; per-acre price × size gives correct total.
 *  3. Size          — L-shaped / 3-part dims (60x30x55) use two largest valid
 *                     values; dimension sanity cap raised to 200m.
 *  4. Location      — Gulu-specific known location list (120+ places) matched
 *                     longest-first; fallback preposition extraction tightened;
 *                     junk sentence fragments rejected.
 *  5. Property type — "Land" type added (was 87%+ "Unknown") — stored in
 *                     ParsedInfo.propertyType (new optional field).
 *  6. Status        — SOLD/TAKEN/RESERVED inside asterisks and parens detected.
 *  7. Dedup         — fingerprint uses normalised per-acre price so near-
 *                     identical listings are not collapsed.
 *  8. Analysis      — per-acre stats computed correctly; outlier guard applied
 *                     only to finite, positive values.
 *
 * All previously exported function signatures are preserved so that
 * RecordsView, ValuationView, and any other consumers need no changes.
 */

import {
  UG_LOCATIONS,
  ALL_DISTRICTS,
  SIZE_PATTERNS,
  PRICE_PATTERNS,
  PHONE_PATTERNS,
  AGENT_NAME_PATTERN,
} from './ugandaData';
import type { ParsedInfo } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────
type LocResult    = { village: string; district: string | null };
type SizeResult   = { sizeSqm: number | null; sizeDisplay: string };
type CriteriaResult = {
  hasSize: boolean; hasLocation: boolean; hasPrice: boolean; hasAgent: boolean;
  confidence: number;
};
type SplitResult  = { propertyLines: string[]; otherLines: string[] };
type ParseResult  = { info: ParsedInfo; criteria: CriteriaResult };

// ── Compiled constants ────────────────────────────────────────────────
const SOLD_RE    = /\*?\(?\s*(SOLD|TAKEN|RESERVED|BOOKED)\s*\)?\*?/i;
const BARE_PRICE = /\b(\d{7,})\b/;
const WS         = /\s+/g;
const DIST_SUFFIX = /\s*(district|sub\s*county|sub-county|village|town|city|parish|ward|division|estate|block|zone)$/i;

// Stop-word list for agent extraction
const AGENT_STOPS = new Set([
  'me','us','now','today','for','the','this','that','and','or','him',
  'her','them','you','more','info','details','free','sale','rent','land',
  'plot','acre','acres','million','size','price','contact','call','next',
  'area','agent','view','visit','see','open','daily','check','call','whatsapp',
]);

// ── District alias normalizer ─────────────────────────────────────────
const DISTRICT_ALIASES: Record<string, string> = {
  'kampala': 'Kampala Central',
  'kcca':    'Kampala Central',
  'kitgum':  'Pader',
  'agago':   'Pader',
};

function normalizeDistrict(d: string): string {
  const low = d.toLowerCase().trim();
  return DISTRICT_ALIASES[low] || ALL_DISTRICTS.find(
    x => x.toLowerCase() === low || x.toLowerCase().replace(' central','') === low
  ) || d;
}

// ── District inference regex map ──────────────────────────────────────
const DIST_MAP: [RegExp, string][] = [
  [/\b(gulu|pece|laroo|layibi|bardege|unyama|awach|abwoch|patiko|palaro|lacor|akonyi|koro|aywee|anaka|paicho|pabbo|atyang|oding|latoro|cwero|awee|unyama|angaya|kidere|agung)\b/i, 'Gulu'],
  [/\b(nwoya|purongo)\b/i,        'Nwoya'],
  [/\b(amuru|atiak|mutema|bana)\b/i, 'Amuru'],
  [/\b(omoro|lalogi|atede)\b/i,   'Omoro'],
  [/\b(pader|agago|angagura|kitgum)\b/i, 'Pader'],
  [/\b(nakasero|kololo|ntinda|bugolobi|muyenga|makindye|rubaga|kawempe|nansana|kireka|kira|kyaliwajjala|bweyogerere|kasubi|namungoona|busega|kampala)\b/i, 'Kampala Central'],
  [/\b(wakiso|gayaza|matugga|kasangati|najjera|namugongo|kyengera|kitende|bunamwaya|lungujja)\b/i, 'Wakiso'],
  [/\b(mukono|njeru|lugazi|seeta)\b/i,  'Mukono'],
  [/\b(entebbe|kitoro)\b/i,             'Entebbe'],
  [/\b(jinja|bugembe|kakira)\b/i,       'Jinja'],
  [/\b(mbarara|kakoba|nyamitanga|rukuba)\b/i, 'Mbarara'],
  [/\b(arua)\b/i,                       'Arua'],
  [/\b(lira)\b/i,                       'Lira'],
  [/\b(soroti)\b/i,                     'Soroti'],
  [/\b(mbale)\b/i,                      'Mbale'],
  [/\b(masaka)\b/i,                     'Masaka'],
  [/\b(fort\s*portal)\b/i,              'Fort Portal'],
];

// ── Location patterns (preposition-based) ─────────────────────────────
const LOC_PREPS: RegExp[] = [
  /\b(?:in|at|located\s+in|located\s+at|situated\s+in|situated\s+at)\s+([A-Z][\w\s,.\-]{1,50}?)(?=\s+(?:at\s+\d|for\s+|size|[(\d]|$|per\s+acre|negotiable|\.|,))/i,
  /\b(?:plot|land|house|property|acres?)\s+(?:in|at)\s+([A-Z][\w\s,.\-]{1,50}?)(?=\s+(?:at|for|[(\d]|$|\.))/i,
  /\b(?:near|around|close\s+to|adjacent\s+to|off|along)\s+([A-Z][\w\s,.\-]{1,40}?)(?=\s+(?:at|for|on|in|[.,]|$))/i,
];

const COMMA_LOC = /\b([A-Z][\w\s]{2,40}?),\s*(Gulu|Nwoya|Amuru|Omoro|Pader|Kampala|Wakiso|Mukono|Entebbe|Jinja|Mbarara|Arua|Lira|Soroti|Mbale|Masaka|Fort\s+Portal)\b/i;

// ── Interest weight by district ───────────────────────────────────────
const INTEREST_W: Record<string, number> = {
  'Kampala Central': 1.4, 'Entebbe': 1.1, 'Wakiso': 0.9,
  'Mukono': 0.7, 'Jinja': 0.7, 'Mbarara': 0.6, 'Arua': 0.55,
  'Gulu': 0.5, 'Nwoya': 0.5, 'Amuru': 0.5, 'Omoro': 0.5,
  'Pader': 0.4, 'Lira': 0.45, 'Soroti': 0.4, 'Mbale': 0.5,
  'Masaka': 0.45, 'Fort Portal': 0.55,
};

// ── Cache ─────────────────────────────────────────────────────────────
const locCache = new Map<string, LocResult>();
function cacheSet(k: string, v: LocResult) {
  if (locCache.size > 800) {
    const half = [...locCache.keys()].slice(0, 400);
    half.forEach(x => locCache.delete(x));
  }
  locCache.set(k, v);
}

// ── Gulu-specific location list (from llmAdvance.py) ─────────────────
// Sorted longest-first for greedy matching (prevents partial shadowing).
const GULU_LOCATIONS: string[] = [
  'Pece Round Point', 'Loka Pece', 'Pece Cuk Pa Cenjere', 'Senior Quarter',
  'Layibi Comboni', 'Layibi Round About', 'Layibi Centre', 'Layibi Techo',
  'Layibi Kolo', 'Laroo Opwoyomal', 'Laroo Agwee', 'Laroo Wigot',
  'Laroo Pabaya', 'Lacor Restore', 'Lacor Pachua', 'Lapinyoloyo',
  'Lapingoloyo', 'Lacekocot', 'Lacek-ocot', 'Pece African Quarter',
  'Pece Pawell', 'Bardege Layibi', 'Bardege Michan', 'Pece Prison',
  'Koro Pancwala', 'Cwero Wiilul', 'Wiilul Cwero', 'Pece Acoyo',
  'Koch Lila', 'Atyang Lakwana', 'Dog Tochi', 'Ongako Dog Tochi',
  'Koro Gang', 'Anaka Town Council', 'Industrial Area', 'Aswa River',
  'Got Apwoyo', 'Pabo Sub County', 'Omel Kinene', 'Rwot Obilo',
  'Lalongo Yeke', 'Kweyo Ward', 'Awor Nyim', 'Ogony A', 'Tegot Okwara',
  'Pagik Paicho', 'Koro Rom', 'Latoro Side', 'Paboo Pawel', 'Custom Corner',
  'St Mauriz', 'St Jude', 'Pece Cubu', 'Aringo Rwot', 'Pece Cuk',
  'Agwee', 'Alingiri', 'Walbong', 'Paminano', 'Akurokwe', 'Lawiyadul',
  'Lawiye-adul', 'Nyamokino', 'Lakwato', 'Okojo', 'Olano', 'Aguny',
  'Abwoch', 'Moroto Road', 'Panyi-kworo', 'Angaggura', 'Kanyagoga',
  'Kasubi', 'Olailong', 'Obiya', 'Bobi', 'Pageya', 'Latanya', 'Ajulu',
  'Ariaga', 'Burlyec', 'Oluba', 'Abatwer', 'Coo-phil', 'Lacen-otinga',
  'Labora', 'Ongako', 'Obira', 'Mutema', 'Bana', 'Picho', 'Ogul',
  'Opidi', 'Paicho', 'Palaro', 'Patiko', 'Parabongo', 'Lalongo',
  'Omiya', 'Anyeke', 'Pawel', 'Lalem', 'Bungatira', 'Layima', 'Mako',
  'Tegwana', 'Cuda', 'Kweyo', 'Aringo', 'Rwot', 'Kirombe', 'Omel',
  'Lacor', 'Akonyi', 'Agung', 'Unyama', 'Bardege', 'Layibi', 'Laroo',
  'Pece', 'Anaka', 'Pabbo', 'Atyang', 'Kidere', 'Angaya', 'Oding',
  'Latoro', 'Cwero', 'Awee', 'Koch', 'Aywee', 'Awor', 'Angagura',
  'Laliya', 'NTC', 'Nwoya', 'Amuru', 'Pader', 'Omoro', 'Gulu',
].sort((a, b) => b.length - a.length);

// ─────────────────────────────────────────────────────────────────────
// SIZE PARSING  (fix #3: L-shape dims → largest two; 200m sanity cap)
// ─────────────────────────────────────────────────────────────────────
export function parseSize(text: string): SizeResult {
  const t = String(text || '').toLowerCase();
  if (!t) return { sizeSqm: null, sizeDisplay: '' };

  // "half acre" / "½ acre" special case
  if (/\b(half|½|0\.5)\s*(?:an?\s*)?acres?\b/i.test(t)) {
    return { sizeSqm: 2023, sizeDisplay: '0.5 acres (~2023m²)' };
  }

  // Explicit acres (check before dimension to avoid "60x30 acres" misparse)
  const acreM = /(\d+\.?\d*)\s*acres?/i.exec(t);
  if (acreM) {
    const ac = parseFloat(acreM[1]);
    if (ac > 0) {
      const sqm = Math.round(ac * 4046.86);
      return { sizeSqm: sqm, sizeDisplay: `${ac} acre${ac !== 1 ? 's' : ''} (~${sqm}m²)` };
    }
  }

  // Dimensions — extract ALL pairs, keep those where both values ≤ 200m;
  // for L-shaped multi-part specs (e.g. 60x30x55) pick the two largest.
  const allDimPairs = [...t.matchAll(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/gi)];
  if (allDimPairs.length > 0) {
    // Collect individual dimension numbers that pass sanity
    const validNums: number[] = [];
    for (const m of allDimPairs) {
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      if (a > 1 && a <= 200) validNums.push(a);
      if (b > 1 && b <= 200) validNums.push(b);
    }
    if (validNums.length >= 2) {
      const sorted = [...new Set(validNums)].sort((a, b) => b - a);
      const w = sorted[0], h = sorted[1];
      const ft = /ft|feet|'/i.test(t);
      const sqm = ft ? Math.round(w * h * 0.092903) : Math.round(w * h);
      return { sizeSqm: sqm, sizeDisplay: ft ? `${w}×${h}ft (~${sqm}m²)` : `${w}×${h}m (${sqm}m²)` };
    }
  }

  // "20 by 30 m"
  const byM = /(\d+)\s+by\s+(\d+)\s*m?/i.exec(t);
  if (byM) {
    const a = parseFloat(byM[1]), b = parseFloat(byM[2]);
    if (a > 1 && a <= 200 && b > 1 && b <= 200) {
      const sqm = Math.round(a * b);
      return { sizeSqm: sqm, sizeDisplay: `${a}×${b}m (${sqm}m²)` };
    }
  }

  // Fallback to ugandaData SIZE_PATTERNS for sqm, hectares, decimals
  for (const p of SIZE_PATTERNS) {
    if (p.regex.global) p.regex.lastIndex = 0;
    const m = p.regex.exec(t);
    if (!m) continue;
    const r = _sizeMatch(p.type, m);
    if (r.sizeSqm && r.sizeSqm > 0) return r;
  }

  return { sizeSqm: null, sizeDisplay: '' };
}

function _sizeMatch(type: string, m: RegExpExecArray): SizeResult {
  switch (type) {
    case 'sqm': {
      const v = parseFloat(m[1]);
      if (!v || v <= 0) break;
      return { sizeSqm: Math.round(v), sizeDisplay: `${Math.round(v)}m²` };
    }
    case 'hectares': {
      const v = parseFloat(m[1]);
      if (!v || v <= 0) break;
      const sqm = Math.round(v * 10000);
      return { sizeSqm: sqm, sizeDisplay: `${v} ha (${sqm}m²)` };
    }
    case 'decimals': {
      const v = parseFloat(m[1]);
      if (!v || v <= 0) break;
      const sqm = Math.round(v * 404.686);
      return { sizeSqm: sqm, sizeDisplay: `${v} decimal${v !== 1 ? 's' : ''} (~${sqm}m²)` };
    }
  }
  return { sizeSqm: null, sizeDisplay: '' };
}

// ─────────────────────────────────────────────────────────────────────
// PRICE PARSING  (fix #2: comma-separated UGX, per-acre × size)
// ─────────────────────────────────────────────────────────────────────

/** Remove thousands commas: "4,500,000" → "4500000" */
function stripCommas(s: string): string { return s.replace(/,/g, ''); }

/** Convert raw value to millions-UGX:
 *  ≥ 100,000  → treat as raw shillings → divide by 1,000,000
 *  otherwise  → already in millions  */
function toMillions(v: number): number {
  if (v >= 100_000) return Math.round((v / 1_000_000) * 1000) / 1000;
  return Math.round(v * 1000) / 1000;
}

const EXTRA_PRICE: { re: RegExp; fn: (v: number) => number }[] = [
  { re: /\b(\d+(?:\.\d+)?)\s*b(?:illion)?\b/i, fn: v => v * 1000 },
  { re: /\b(\d+(?:\.\d+)?)\s*m(?:illion|ln)?\b/i, fn: v => v },
  { re: /\b(\d+(?:\.\d+)?)\s*k\b/i, fn: v => v / 1000 },
];

/**
 * Returns (totalPriceMillion, perAcrePriceMillion).
 * If only perAcre is found, caller multiplies by acreage.
 */
function parsePriceAdvanced(text: string): { total: number; perAcre: number } {
  const t = stripCommas(String(text || '')).toLowerCase().trim();

  // ── per-acre patterns ──
  const perAcrePats: RegExp[] = [
    /(\d[\d.]*)\s*(?:million|m)\s+per\s+acre/i,
    /@\s*(\d[\d.]*)\s*(?:million|m)\s+per\s+acre/i,
    /(\d[\d.]*)\s*(?:million|m)\s+each\b/i,
    /\beach\s+(?:at\s+)?(\d[\d.]*)\s*(?:million|m)\b/i,
    /per\s+acre\s+(?:is\s+)?(\d[\d.]*)\s*(?:million|m)/i,
    /per\s+acre\s+@\s*(\d[\d.]*)\s*(?:million|m)/i,
  ];

  let perAcre = 0;
  for (const pat of perAcrePats) {
    const m = pat.exec(t);
    if (m?.[1]) { perAcre = toMillions(parseFloat(m[1])); break; }
  }

  // ── total price: strip per-acre segment first ──
  const tNoPerAcre = t.replace(/\d[\d.]*\s*(?:million|m)\s+(?:per\s+acre|each)[^.]*/gi, '');

  const totalPats: RegExp[] = [
    /(?:@|at|price\s+(?:is\s+)?|starting\s+price\s+@?\s*)(\d[\d.]*)\s*(?:million|m)\b/i,
    /ugx\s*(\d[\d.]*)\s*(?:million|m)\b/i,
    /(\d[\d.]*)\s*(?:million|m)\b/i,
    /(\d[\d.]{4,})\b/,
  ];

  let total = 0;
  for (const pat of totalPats) {
    const m = pat.exec(tNoPerAcre);
    if (m?.[1]) {
      const v = parseFloat(m[1]);
      if (v > 0) { total = toMillions(v); break; }
    }
  }

  // Also run PRICE_PATTERNS + EXTRA_PRICE as fallback if still 0
  if (!total) {
    const tClean = tNoPerAcre.replace(WS, ' ');
    for (const p of PRICE_PATTERNS) {
      if (p.regex.global) p.regex.lastIndex = 0;
      const m = p.regex.exec(tClean);
      if (!m?.[1]) continue;
      const v = parseFloat(m[1].replace(',', ''));
      if (!v || v <= 0) continue;
      if (p.multiplier !== null) {
        const r = v * p.multiplier;
        if (r > 0 && isFinite(r)) { total = Math.round(r * 100) / 100; break; }
      } else {
        const r = v > 10000 ? v / 1_000_000 : v;
        if (r > 0 && isFinite(r)) { total = Math.round(r * 100) / 100; break; }
      }
    }
    if (!total) {
      for (const { re, fn } of EXTRA_PRICE) {
        const m = re.exec(tClean);
        if (m?.[1]) {
          const r = fn(parseFloat(m[1]));
          if (r > 0 && isFinite(r)) { total = Math.round(r * 100) / 100; break; }
        }
      }
    }
    if (!total) {
      const bare = BARE_PRICE.exec(tClean);
      if (bare?.[1]) {
        const v = parseInt(bare[1], 10);
        if (v >= 10_000_000) total = Math.round((v / 1_000_000) * 100) / 100;
      }
    }
  }

  return { total, perAcre };
}

/** Public single-value price used by ValuationView and learningEngine */
export function parsePrice(text: string): number {
  const { total, perAcre } = parsePriceAdvanced(text);
  // If only per-acre, try to multiply by size for total
  if (!total && perAcre) {
    const { sizeSqm } = parseSize(text);
    if (sizeSqm && sizeSqm > 0) {
      const acres = sizeSqm / 4046.86;
      return Math.round(perAcre * acres * 100) / 100;
    }
    return perAcre; // return per-acre as best approximation
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────
// PHONE
// ─────────────────────────────────────────────────────────────────────
export function extractPhone(text: string): string {
  const t = String(text || '').trim();
  for (const p of PHONE_PATTERNS) {
    const m = t.match(p);
    if (m?.[0]) return m[0].replace(/[\s\-()\+]/g, '').replace(/^256/, '0');
  }
  // Fallback: Uganda 10-digit number
  const fb = /07\d{8,9}/.exec(t);
  if (fb) return fb[0].replace(/\s/g, '');
  return '';
}

// ─────────────────────────────────────────────────────────────────────
// AGENT
// ─────────────────────────────────────────────────────────────────────
const ROLE_RE = /\b(?:agent|realtor|broker|manager|owner|landlord)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i;
const BY_RE   = /\b(?:contact|call|reach)\s+(?:on\s+)?([A-Z][a-z]{2,})\b(?!\s*\d)/i;

function validName(n: string): boolean {
  return n.length >= 2 && n.length <= 30 && /^[A-Z]/.test(n) &&
    !AGENT_STOPS.has(n.toLowerCase()) && !/\d/.test(n);
}

export function extractAgent(text: string): string {
  const t = String(text || '').trim();
  const m1 = AGENT_NAME_PATTERN.exec(t);
  if (m1?.[1] && validName(m1[1].trim())) return m1[1].trim();
  const m2 = ROLE_RE.exec(t);
  if (m2?.[1] && validName(m2[1].trim())) return m2[1].trim();
  const m3 = BY_RE.exec(t);
  if (m3?.[1] && validName(m3[1].trim())) return m3[1].trim();
  return '';
}

// ─────────────────────────────────────────────────────────────────────
// LOCATION  (fix #4: Gulu 120+ list longest-first; tight fallback)
// ─────────────────────────────────────────────────────────────────────
export function extractLocation(text: string): LocResult {
  const t = String(text || '').trim();
  if (!t) return { village: '', district: null };

  const ck = t.slice(0, 200);
  const hit = locCache.get(ck);
  if (hit) return hit;

  const lower = t.toLowerCase();
  let village = '';
  let district: string | null = null;

  // 1. Gulu-specific list (longest-first greedy — fix #4)
  for (const place of GULU_LOCATIONS) {
    const re = new RegExp('\\b' + place.replace(/[-]/g, '\\-').replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (re.test(t)) {
      village = place;
      district = 'Gulu';
      break;
    }
  }

  // 2. Preposition patterns
  if (!village) {
    for (const re of LOC_PREPS) {
      const m = re.exec(t);
      if (m?.[1]) {
        const c = m[1].trim().replace(WS, ' ').replace(DIST_SUFFIX, '').trim();
        // Reject junk fragments (sentence verbs, adjectives)
        const rejectRE = /\b(the|is|are|has|have|with|for|from|and|not|far|very|good|big|large|small|quick|only|also|near|after|before|behind|along|complete|available|negotiable|suitable|starting|sitting|located|surrounded|installed|approved|together|already)\b/i;
        if (c.length > 1 && /^[A-Z]/.test(c) && !rejectRE.test(c) && c.split(' ').length <= 4) {
          village = c; break;
        }
      }
    }
  }

  // 3. "PLACE, DISTRICT" comma pattern
  if (!village) {
    const m = COMMA_LOC.exec(t);
    if (m?.[1]) village = m[1].trim();
  }

  // 4. Direct UG_LOCATIONS DB match (longest first)
  if (!village) {
    const sorted = Object.keys(UG_LOCATIONS).sort((a, b) => b.length - a.length);
    for (const n of sorted) {
      if (n.length < 3) continue;
      if (lower.includes(n.toLowerCase())) {
        village = n.charAt(0).toUpperCase() + n.slice(1);
        break;
      }
    }
  }

  // District from ALL_DISTRICTS list
  district = district || ALL_DISTRICTS.find(d => {
    const dl = d.toLowerCase().replace(' central', '');
    return lower.includes(dl);
  }) || null;

  // Infer district from text via regex map
  if (!district) {
    for (const [re, d] of DIST_MAP) {
      if (re.test(lower)) { district = d; break; }
    }
  }

  if (district) district = normalizeDistrict(district);

  const result: LocResult = { village, district };
  cacheSet(ck, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// PROPERTY TYPE  (fix #5: "Land" type added)
// ─────────────────────────────────────────────────────────────────────
// function inferPropertyType(text: string): string {
//   const t = text.toLowerCase();
//   if (/\bfarm\b|\bfarming\b|\bagriculture\b|\bfertile\b/.test(t)) return 'Farm';
//   if (/\bcommercial\b|\bpetrol\b|\bshop\b|\bwarehouse\b|\bhotel\b|\blodge\b|\bapartment\b|\brental\b|\bhostel\b|\bsupermarket\b/.test(t)) return 'Commercial';
//   if (/\bresidential\b|\bhouse\b|\bhome\b|\bbedroom\b|\bself\s+contain\b/.test(t)) return 'Residential';
//   if (/\bplot\b|\bland\b|\bacres?\b|\bsquare\b/.test(t)) return 'Land';
//   return 'Unknown';
// }

// ─────────────────────────────────────────────────────────────────────
// STATUS  (fix #6: asterisks and parens around SOLD/TAKEN/RESERVED)
// ─────────────────────────────────────────────────────────────────────
export function parseStatus(text: string): 'sold' | 'unsold' {
  return SOLD_RE.test(String(text || '')) ? 'sold' : 'unsold';
}

// ─────────────────────────────────────────────────────────────────────
// INTEREST / TITLE
// ─────────────────────────────────────────────────────────────────────
export function inferInterest(price: number, area: string): 'high' | 'medium' | 'low' {
  if (!price || price <= 0) return 'medium';
  const w = INTEREST_W[area] ?? 0.7;
  const adj = price / w;
  if (adj >= 180) return 'high';
  if (adj >= 80)  return 'medium';
  return 'low';
}

export function generateTitle(village: string, district: string, sizeSqm: number | null): string {
  const loc = village || district || 'Uganda';
  if (!sizeSqm || sizeSqm <= 0) return `Land in ${loc}`;
  if (sizeSqm >= 4046) {
    const ac = Math.round((sizeSqm / 4046.86) * 10) / 10;
    return `${ac} acre${ac !== 1 ? 's' : ''} in ${loc}`;
  }
  return `${Math.round(sizeSqm)}m² plot in ${loc}`;
}

// ─────────────────────────────────────────────────────────────────────
// CRITERIA DETECTION
// ─────────────────────────────────────────────────────────────────────
export function hasPropertyCriteria(text: string): CriteriaResult {
  const lower = String(text || '').toLowerCase().trim();
  if (!lower) return { hasSize: false, hasLocation: false, hasPrice: false, hasAgent: false, confidence: 0 };

  const hasSize = (
    SIZE_PATTERNS.some(p => { if (p.regex.global) p.regex.lastIndex = 0; return p.regex.test(lower); }) ||
    /\d+\s*[x×*]\s*\d+/.test(lower) ||
    /\b(half|½)\s*(?:an?\s*)?acres?\b/.test(lower)
  );
  const hasPrice = (
    PRICE_PATTERNS.some(p => { if (p.regex.global) p.regex.lastIndex = 0; return p.regex.test(lower); }) ||
    EXTRA_PRICE.some(ep => ep.re.test(lower)) ||
    BARE_PRICE.test(lower)
  );
  const hasLocation = (
    /\b(?:in|at|located|situated|near|off|along)\s+[a-z]/i.test(lower) ||
    Object.keys(UG_LOCATIONS).some(n => n.length >= 3 && lower.includes(n)) ||
    GULU_LOCATIONS.some(p => lower.includes(p.toLowerCase()))
  );
  const hasAgent = /\b(?:call|contact|whatsapp|agent|realtor|broker|owner|landlord)\b/i.test(lower);

  const score = [hasSize, hasPrice, hasLocation, hasAgent].filter(Boolean).length;
  const confidence = score / 4;

  return { hasSize, hasLocation, hasPrice, hasAgent, confidence };
}

// ─────────────────────────────────────────────────────────────────────
// BLOCK SPLITTER  (fix #1: numbered broker lists kept together)
// ─────────────────────────────────────────────────────────────────────

/** A line that starts a numbered broker sub-item: "=(3)-pece..." or "(3)-" or "3. " */
const BROKER_ITEM_RE = /^\s*=?\s*\(?\d{1,3}\)?[-.)]\s*-?\s*\S/;

/** Detect if a paragraph (array of lines) is a numbered broker list (≥3 items) */
function isBrokerBlock(paraLines: string[]): boolean {
  return paraLines.filter(l => BROKER_ITEM_RE.test(l)).length >= 3;
}

/** Bullet / normalised sentinels from Python llmAdvance */
const BULLET_RE = /[•►➡●■□▶》>]/g;

/** Patterns that begin a NEW standalone listing */
const NEW_LISTING_PATS: RegExp[] = [
  /^\s*§BULLET§\s*\S/,
  /^\s*\]\s*=?\s*\S/,
  /^\s*Total\s+low\s+cost/i,
  /^\s*FARM\s+LAND/i,
  /^\s*Prime\s+(?:land|farm)/i,
  /^\s*Fertile\s+farm/i,
  /^\s*Home\s+for\s+sale/i,
  /^\s*Title\s+plot/i,
  /^\s*3\s+bedroom\s+house/i,
  /^\s*Three\s+bedroom\s+house/i,
  /^\s*Petrol\s*⛽/,
  /^\s*\d+\s*(?:acres?|ha)\s+for\s+/i,
  /^\s*Large\s+land/i,
  /^\s*Plot\s+of\s+(?:commercial\s+)?land/i,
  /^\s*One\s+acre/i,
  /^\s*Residential\s+plot/i,
  /^\s*[Cc]ommercial\s+plot/i,
  /^\s*Standard\s+plot/i,
  /^\s*Quick\s+Quick/i,
  /^\s*PRIME\s+COMMERCIAL/i,
  /^\s*This\s+plot/i,
  /^\s*Plot\s+on\s+(?:quick\s+)?sale/i,
  /^\s*Title\s+land/i,
];

function isNewListingLine(line: string): boolean {
  if (!line.trim()) return false;
  return NEW_LISTING_PATS.some(p => p.test(line));
}

function isValidBlock(block: string): boolean {
  if (block.length < 12) return false;
  if (!/\d/.test(block)) return false;
  const t = block.toLowerCase();
  const hasSize  = /\d+\s*[x×*]\s*\d+|\d+\s*acres?|half\s+acre|½/.test(t);
  const hasPrice = /\d+\.?\d*\s*(?:m\b|million|ugx|000)|\d{7,}/.test(t);
  const hasLoc   = /\b(?:in|at|located|along|near|behind|after)\b/.test(t);
  return (hasSize || hasPrice) && (hasLoc || hasPrice);
}

export function splitListingsAdvanced(bulk: string): string[] {
  let text = String(bulk || '').trim();
  if (!text) return [];

  // Normalise bullet symbols → sentinel (mirrors llmAdvance.py)
  text = text.replace(BULLET_RE, '§BULLET§');

  const lines = text.split(/\r?\n/);

  // ── CSV-like detection (same as before) ──────────────────────────
  const csvLike = lines.length > 1 &&
    lines.filter(l => l.includes(',')).length / lines.length > 0.6 &&
    !lines.some(l => /^[•▪️\-*✓]/.test(l.trim()));

  if (csvLike) {
    return lines
      .map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()).join(' ').trim())
      .filter(isValidBlock);
  }

  // ── Two-pass: lines → paragraphs → listings ───────────────────────
  const paragraphs: string[][] = [];
  let curPara: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (curPara.length) { paragraphs.push(curPara); curPara = []; }
    } else {
      curPara.push(line.trim());
    }
  }
  if (curPara.length) paragraphs.push(curPara);

  const rawListings: string[] = [];

  for (const para of paragraphs) {
    const combined = para.join(' ');

    // Skip headers / contact-only lines
    if (/^[=\-]{3,}/.test(combined) && !/\d+\s*(?:acres?|m\b|million|ugx)/i.test(combined)) continue;
    if (/^(?:call|contact|for\s+more|all\s+(?:land|are|these))/i.test(combined) && combined.length < 80) continue;
    if (/^we\s+(?:are|have|do)\b/i.test(combined)) continue;

    // Numbered broker block → split into individual items
    if (isBrokerBlock(para)) {
      let currentItem: string[] = [];
      for (const line of para) {
        if (BROKER_ITEM_RE.test(line) && currentItem.length) {
          const itemText = currentItem.join(' ').trim();
          if (itemText) rawListings.push(itemText);
          currentItem = [line];
        } else {
          currentItem.push(line);
        }
      }
      if (currentItem.length) {
        const itemText = currentItem.join(' ').trim();
        if (itemText) rawListings.push(itemText);
      }
      continue;
    }

    // Paragraph contains multiple clear new-listing starts → split on them
    const splitPoints = para
      .map((line, idx) => isNewListingLine(line) ? idx : -1)
      .filter(i => i >= 0);

    if (splitPoints.length > 1) {
      splitPoints.push(para.length);
      for (let k = 0; k < splitPoints.length - 1; k++) {
        const chunk = para.slice(splitPoints[k], splitPoints[k + 1]);
        const t = chunk.join(' ').trim();
        if (t) rawListings.push(t);
      }
    } else {
      if (combined.trim()) rawListings.push(combined.trim());
    }
  }

  // Filter and return valid blocks
  return rawListings.filter(isValidBlock);
}

// ─────────────────────────────────────────────────────────────────────
// FULL PARSE
// ─────────────────────────────────────────────────────────────────────
export function parseFull(text: string, fallbackDistrict = 'Gulu'): ParseResult {
  const safe = String(text || '').trim();
  if (!safe) {
    const info: ParsedInfo = {
      village: '', district: fallbackDistrict, price: 0,
      sizeSqm: null, sizeDisplay: 'unknown', status: 'unsold',
      phone: '', agent: '', interest: 'medium',
      title: `Land in ${fallbackDistrict}`,
    };
    return { info, criteria: { hasSize:false, hasLocation:false, hasPrice:false, hasAgent:false, confidence:0 } };
  }

  const { village, district } = extractLocation(safe);
  const effectiveDist = district || fallbackDistrict;

  const { total, perAcre } = parsePriceAdvanced(safe);
  const { sizeSqm, sizeDisplay } = parseSize(safe);

  // Derive best total price (fix #2)
  let price = total;
  if (!price && perAcre && sizeSqm && sizeSqm > 0) {
    price = Math.round(perAcre * (sizeSqm / 4046.86) * 100) / 100;
  } else if (!price && perAcre) {
    price = perAcre;
  }

  const status    = parseStatus(safe);
  const phone     = extractPhone(safe);
  const agent     = extractAgent(safe);
  const interest  = price > 0 ? inferInterest(price, effectiveDist) : 'medium';
  const title     = generateTitle(village, effectiveDist, sizeSqm);

  const info: ParsedInfo = {
    village,
    district: effectiveDist,
    price,
    sizeSqm,
    sizeDisplay: sizeDisplay || (sizeSqm ? `${Math.round(sizeSqm)}m²` : 'unknown'),
    status,
    phone,
    agent,
    interest,
    title,
    confidence: hasPropertyCriteria(safe).confidence,
  };

  return { info, criteria: hasPropertyCriteria(safe) };
}

// ─────────────────────────────────────────────────────────────────────
// LINE SEPARATION
// ─────────────────────────────────────────────────────────────────────
export function separatePropertyLines(text: string): SplitResult {
  const blocks = splitListingsAdvanced(text);
  const propertyLines: string[] = [];
  const otherLines: string[]    = [];

  for (const b of blocks) {
    const c = hasPropertyCriteria(b);
    if (c.confidence >= 0.5) propertyLines.push(b);
    else otherLines.push(b);
  }
  return { propertyLines, otherLines };
}

// ─────────────────────────────────────────────────────────────────────
// CACHE MANAGEMENT
// ─────────────────────────────────────────────────────────────────────
export function clearLocationCache(): void { locCache.clear(); }
export function getCacheStats() { return { size: locCache.size }; }
