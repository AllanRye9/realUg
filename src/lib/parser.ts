/**
 * lib/parser.ts — Uganda Real Estate Text Parser
 *
 * Improvements over previous version:
 *  1. Compound price patterns  — "23m", "350k", "1.5b" all resolved
 *  2. Half-acre pattern        — "half acre / ½ acre" reliably detected
 *  3. Multi-method location    — preposition → comma → DB → regex cascade
 *  4. Agent false-positive guard — enlarged stop-word set + length gate
 *  5. Block splitter           — honours CSV rows, bullet, numbered, blank-line
 *  6. Confidence scoring       — criteria returns 0-1 float, not booleans
 *  7. District normalization   — canonical district names, alias map
 *  8. All regex global flags reset before exec() to prevent state bugs
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
const SOLD_RE    = /\b(sold|taken|booked|reserved|unavailable|not\s+available)\b/i;
const BARE_PRICE = /\b(\d{7,})\b/;
const WS         = /\s+/g;
const DIST_SUFFIX = /\s*(district|sub\s*county|sub-county|village|town|city|parish|ward|division|estate|block|zone)$/i;

// Expanded stop-word list for agent extraction
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
  [/\b(gulu|pece|laroo|layibi|bardege|unyama|awach|abwoch|patiko|palaro)\b/i,  'Gulu'],
  [/\b(nwoya|anaka|purongo)\b/i,        'Nwoya'],
  [/\b(amuru|atiak|pabbo|mutema|bana)\b/i, 'Amuru'],
  [/\b(omoro|lalogi|koro|atede|atyang)\b/i,'Omoro'],
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

// ─────────────────────────────────────────────────────────────────────
// SIZE PARSING
// ─────────────────────────────────────────────────────────────────────
export function parseSize(text: string): SizeResult {
  const t = String(text || '').toLowerCase();
  if (!t) return { sizeSqm: null, sizeDisplay: '' };

  // "half acre" / "½ acre" special case
  if (/\b(half|½|0\.5)\s*(?:an?\s*)?acres?\b/i.test(t)) {
    return { sizeSqm: 2023, sizeDisplay: '0.5 acres (~2023m²)' };
  }

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
    case 'dimensions': {
      const a = parseFloat(m[1]), b = parseFloat(m[2]);
      if (!a || !b || a <= 0 || b <= 0) break;
      const ft = /ft|feet|'/i.test(m[0]);
      const sqm = ft ? Math.round(a * b * 0.092903) : Math.round(a * b);
      return { sizeSqm: sqm, sizeDisplay: ft ? `${a}×${b}ft (~${sqm}m²)` : `${a}×${b}m (${sqm}m²)` };
    }
    case 'acres': {
      const raw = (m[1] || '').trim().toLowerCase();
      const ac  = raw === 'half' ? 0.5 : parseFloat(raw);
      if (!ac || ac <= 0) break;
      const sqm = Math.round(ac * 4046.86);
      return { sizeSqm: sqm, sizeDisplay: `${ac} acre${ac !== 1 ? 's' : ''} (~${sqm}m²)` };
    }
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
// PRICE PARSING — improved compound patterns
// ─────────────────────────────────────────────────────────────────────
/** Extra patterns not in ugandaData (compound shorthands like "23m", "1.5b") */
const EXTRA_PRICE: { re: RegExp; fn: (v: number) => number }[] = [
  { re: /\b(\d+(?:\.\d+)?)\s*b(?:illion)?\b/i, fn: v => v * 1000 },
  { re: /\b(\d+(?:\.\d+)?)\s*m(?:illion|ln)?\b/i, fn: v => v },
  { re: /\b(\d+(?:\.\d+)?)\s*k\b/i, fn: v => v / 1000 },
];

export function parsePrice(text: string): number {
  const t = String(text || '').toLowerCase().replace(/,/g, '').replace(WS, ' ').trim();
  if (!t) return 0;

  // Structured patterns first (from ugandaData)
  for (const p of PRICE_PATTERNS) {
    if (p.regex.global) p.regex.lastIndex = 0;
    const m = p.regex.exec(t);
    if (!m?.[1]) continue;
    const v = parseFloat(m[1]);
    if (!v || v <= 0) continue;
    if (p.multiplier !== null) {
      const r = v * p.multiplier;
      if (r > 0 && isFinite(r)) return Math.round(r * 100) / 100;
    } else {
      // Raw UGX string — convert from shillings if > 10 000
      const r = v > 10000 ? v / 1_000_000 : v;
      if (r > 0 && isFinite(r)) return Math.round(r * 100) / 100;
    }
  }

  // Extra compound shorthands ("23m", "1.5b", "350k")
  for (const { re, fn } of EXTRA_PRICE) {
    const m = re.exec(t);
    if (m?.[1]) {
      const v = parseFloat(m[1]);
      if (v > 0) {
        const r = fn(v);
        if (r > 0 && isFinite(r)) return Math.round(r * 100) / 100;
      }
    }
  }

  // Bare large integer fallback (7+ digits → shillings)
  const bare = BARE_PRICE.exec(t);
  if (bare?.[1]) {
    const v = parseInt(bare[1], 10);
    if (v >= 10_000_000) return Math.round((v / 1_000_000) * 100) / 100;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// PHONE
// ─────────────────────────────────────────────────────────────────────
export function extractPhone(text: string): string {
  const t = String(text || '').trim();
  for (const p of PHONE_PATTERNS) {
    const m = t.match(p);
    if (m?.[0]) return m[0].replace(/[\s\-()]/g, '');
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────
// AGENT
// ─────────────────────────────────────────────────────────────────────
const ROLE_RE = /\b(?:agent|realtor|broker|manager|owner|landlord)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i;
const BY_RE   = /\b(?:contact|call|reach)\s+(?:on\s+)?([A-Z][a-z]{2,})\b(?!\s*\d)/i;

function validName(n: string): boolean {
  return n.length >= 2 &&
    n.length <= 30 &&
    /^[A-Z]/.test(n) &&
    !AGENT_STOPS.has(n.toLowerCase()) &&
    !/\d/.test(n);
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
// LOCATION
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

  // 1. Preposition patterns
  for (const re of LOC_PREPS) {
    const m = re.exec(t);
    if (m?.[1]) {
      const c = m[1].trim().replace(WS, ' ').replace(DIST_SUFFIX, '').trim();
      if (c.length > 1 && /^[A-Z]/.test(c)) { village = c; break; }
    }
  }

  // 2. "PLACE, DISTRICT" comma pattern
  if (!village) {
    const m = COMMA_LOC.exec(t);
    if (m?.[1]) village = m[1].trim();
  }

  // 3. Direct local DB match (longest first → greedy)
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
  district = ALL_DISTRICTS.find(d => {
    const dl = d.toLowerCase().replace(' central', '');
    return lower.includes(dl);
  }) || null;

  // Infer district from village text
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
// STATUS / INTEREST / TITLE
// ─────────────────────────────────────────────────────────────────────
export function parseStatus(text: string): 'sold' | 'unsold' {
  return SOLD_RE.test(String(text || '')) ? 'sold' : 'unsold';
}

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
// CRITERIA DETECTION — returns confidence float
// ─────────────────────────────────────────────────────────────────────
export function hasPropertyCriteria(text: string): CriteriaResult {
  const lower = String(text || '').toLowerCase().trim();
  if (!lower) return { hasSize: false, hasLocation: false, hasPrice: false, hasAgent: false, confidence: 0 };

  const hasSize     = SIZE_PATTERNS.some(p => { if (p.regex.global) p.regex.lastIndex = 0; return p.regex.test(lower); });
  const hasPrice    = PRICE_PATTERNS.some(p => { if (p.regex.global) p.regex.lastIndex = 0; return p.regex.test(lower); })
    || EXTRA_PRICE.some(ep => ep.re.test(lower))
    || BARE_PRICE.test(lower);
  const hasLocation = /\b(?:in|at|located|situated|near|off|along)\s+[a-z]/i.test(lower)
    || Object.keys(UG_LOCATIONS).some(n => n.length >= 3 && lower.includes(n));
  const hasAgent    = /\b(?:call|contact|whatsapp|agent|realtor|broker|owner|landlord)\b/i.test(lower);

  const score = [hasSize, hasPrice, hasLocation, hasAgent].filter(Boolean).length;
  const confidence = score / 4;

  return { hasSize, hasLocation, hasPrice, hasAgent, confidence };
}

// ─────────────────────────────────────────────────────────────────────
// BLOCK SPLITTING — txt, csv, bullet, numbered, blank-line
// ─────────────────────────────────────────────────────────────────────
function isNewStart(line: string): boolean {
  const t = line.trim();
  const l = t.toLowerCase();
  if (/^[•▪️\-*✓✅🔹🔸➤►▶]\s/.test(t))  return true;
  if (/^\d{1,2}[.)]\s/.test(t))           return true;
  if (/^(land|plot|for\s+sale|prime|residential|commercial|house|villa|apt|building|acre)/i.test(l)) return true;
  const hasP = /(?:million|ugx|shs|\d+\s*m\b|\d{7,}|(?<!\d)\d+(?:\.\d+)?\s*[bBmMkK]\b)/i.test(l);
  const hasS = /(?:acres?|sqm|m²|½|half\s+acre|\d+\s*[x×]\s*\d+|decimals?|hectares?)/i.test(l);
  const hasL = /\b(?:in|at|located|near|off|along)\s+[A-Z]/i.test(l);
  return [hasP, hasS, hasL].filter(Boolean).length >= 2;
}

function isValidBlock(block: string): boolean {
  if (block.length < 12) return false;
  if (!/\d/.test(block)) return false;
  return /(?:million|ugx|shs|acres?|sqm|m²|half\s+acre|plot|land|\d+\s*[x×]\s*\d+|\d{7,}|\d+\s*[bBmMkK]\b)/i.test(block);
}

export function splitListingsAdvanced(bulk: string): string[] {
  const text = String(bulk || '').trim();
  if (!text) return [];

  // CSV rows: if lines have commas and no clear bullet structure, treat each line as a block
  const lines = text.split(/\r?\n/);
  const csvLike = lines.length > 1 &&
    lines.filter(l => l.includes(',')).length / lines.length > 0.6 &&
    !lines.some(l => /^[•▪️\-*✓]\s/.test(l.trim()));

  if (csvLike) {
    return lines
      .map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()).join(' ').trim())
      .filter(isValidBlock);
  }

  const blocks: string[] = [];
  let cur = '';

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (cur) { blocks.push(cur.trim()); cur = ''; }
      continue;
    }
    if (isNewStart(t) && cur.length > 12) {
      blocks.push(cur.trim());
      cur = t;
    } else {
      cur = cur ? `${cur} ${t}` : t;
    }
  }
  if (cur.trim()) blocks.push(cur.trim());

  // Fallback: double-newline paragraphs
  if (blocks.length === 0 && text.includes('\n\n')) {
    return text.split(/\n\s*\n/).map(b => b.trim()).filter(isValidBlock);
  }

  return blocks.filter(isValidBlock);
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
  const price              = parsePrice(safe);
  const { sizeSqm, sizeDisplay } = parseSize(safe);
  const status             = parseStatus(safe);
  const phone              = extractPhone(safe);
  const agent              = extractAgent(safe);
  const effectiveDist      = district || fallbackDistrict;
  const interest           = price > 0 ? inferInterest(price, effectiveDist) : 'medium';
  const title              = generateTitle(village, effectiveDist, sizeSqm);

  const info: ParsedInfo = {
    village, district: effectiveDist, price, sizeSqm,
    sizeDisplay: sizeDisplay || (sizeSqm ? `${Math.round(sizeSqm)}m²` : 'unknown'),
    status, phone, agent, interest, title,
  };

  return { info, criteria: hasPropertyCriteria(safe) };
}

// ─────────────────────────────────────────────────────────────────────
// LINE SEPARATION (used by analytics / UI)
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
