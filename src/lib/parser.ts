import {
  UG_LOCATIONS,
  ALL_DISTRICTS,
  LOCATION_PREPOSITIONS,
  SIZE_PATTERNS,
  PRICE_PATTERNS,
  AGENT_KEYWORDS,
  AGENT_NAME_PATTERN,
  PHONE_PATTERNS,
} from './ugandaData';
import type { ParsedInfo } from '@/types';

/**
 * Safe string coerce — always returns a string, never throws.
 */
function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

/**
 * Extract size information from text.
 * Handles: "30 x 30", "30 by 30", "1 acre", "3 acres", "0.5 acres", "50 sqm", "2 ha", "10 decimals"
 */
export function parseSize(text: string): { sizeSqm: number | null; sizeDisplay: string } {
  const lower = str(text).toLowerCase();

  for (const pattern of SIZE_PATTERNS) {
    const match = lower.match(pattern.regex);
    if (!match) continue;

    let sizeSqm: number | null = null;
    let sizeDisplay = match[0];

    switch (pattern.type) {
      case 'dimensions': {
        const dim1 = parseFloat(match[1]);
        const dim2 = parseFloat(match[2]);
        if (isFinite(dim1) && isFinite(dim2) && dim1 > 0 && dim2 > 0) {
          const isFeet = /ft|feet/i.test(match[0]);
          if (isFeet) {
            sizeSqm = dim1 * dim2 * 0.092903;
            sizeDisplay = `${dim1}×${dim2}ft (~${Math.round(sizeSqm)}m²)`;
          } else {
            sizeSqm = dim1 * dim2;
            sizeDisplay = `${dim1}×${dim2}m (${Math.round(sizeSqm)}m²)`;
          }
        }
        break;
      }
      case 'acres': {
        let acres: number;
        const raw = str(match[1]).toLowerCase();
        if (raw === 'half') {
          acres = 0.5;
        } else {
          acres = parseFloat(raw);
        }
        if (isFinite(acres) && acres > 0) {
          sizeSqm = acres * 4046.86;
          sizeDisplay = `${acres} acre${acres !== 1 ? 's' : ''} (~${Math.round(sizeSqm)}m²)`;
        }
        break;
      }
      case 'sqm': {
        const val = parseFloat(match[1]);
        if (isFinite(val) && val > 0) {
          sizeSqm = val;
          sizeDisplay = `${Math.round(val)}m²`;
        }
        break;
      }
      case 'hectares': {
        const ha = parseFloat(match[1]);
        if (isFinite(ha) && ha > 0) {
          sizeSqm = ha * 10000;
          sizeDisplay = `${ha} ha (${Math.round(sizeSqm)}m²)`;
        }
        break;
      }
      case 'decimals': {
        const dec = parseFloat(match[1]);
        if (isFinite(dec) && dec > 0) {
          sizeSqm = dec * 404.686;
          sizeDisplay = `${dec} decimal${dec !== 1 ? 's' : ''} (~${Math.round(sizeSqm)}m²)`;
        }
        break;
      }
    }

    if (sizeSqm !== null && sizeSqm > 0) {
      return { sizeSqm, sizeDisplay };
    }
  }

  return { sizeSqm: null, sizeDisplay: '' };
}

/**
 * Parse price from text.
 * Handles: "1m", "2million", "23m", "UGX 50m", "1.5 billion", "500k", bare numbers > 10000
 */
export function parsePrice(text: string): number {
  const raw = str(text);
  const lower = raw.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');

  for (const pattern of PRICE_PATTERNS) {
    const match = lower.match(pattern.regex);
    if (!match) continue;
    const val = parseFloat(match[1]);
    if (!isFinite(val) || val <= 0) continue;

    if (pattern.multiplier !== null) {
      const result = val * pattern.multiplier;
      if (isFinite(result) && result > 0) return result;
    } else {
      // UGX/SHS special: if val > 10000 it's in raw shillings, convert to millions
      const result = val > 10000 ? val / 1_000_000 : val;
      if (isFinite(result) && result > 0) return result;
    }
  }

  // Last resort: bare large number that looks like a price (> 10M shillings)
  const bareMatch = lower.match(/\b(\d{7,})\b/);
  if (bareMatch) {
    const val = parseInt(bareMatch[1], 10);
    if (isFinite(val) && val >= 10_000_000) return val / 1_000_000;
  }

  return 0;
}

/**
 * Extract phone number from text.
 */
export function extractPhone(text: string): string {
  const t = str(text);
  for (const pattern of PHONE_PATTERNS) {
    const match = t.match(pattern);
    if (match) {
      return match[0].replace(/[\s\-\(\)]/g, '');
    }
  }
  return '';
}

/**
 * Extract agent name from text.
 * Handles: "call Andrew", "contact Billy", "call me John", "agent: Sarah"
 */
export function extractAgent(text: string): string {
  const t = str(text);

  const falsePositives = new Set([
    'me', 'us', 'now', 'today', 'for', 'the', 'this', 'that', 'and', 'or',
    'him', 'her', 'them', 'you', 'more', 'info', 'details', 'free',
  ]);

  // Pattern: "call/contact/whatsapp NAME"
  const agentMatch = t.match(AGENT_NAME_PATTERN);
  if (agentMatch?.[1]) {
    const name = agentMatch[1].trim();
    if (!falsePositives.has(name.toLowerCase()) && name.length > 1) {
      return name;
    }
  }

  // Pattern: "agent/realtor/broker: NAME"
  const roleMatch = t.match(/(?:agent|realtor|broker|manager|owner)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (roleMatch?.[1] && !falsePositives.has(roleMatch[1].toLowerCase())) {
    return roleMatch[1];
  }

  // Pattern: "call/contact ... by NAME"
  const byMatch = t.match(/(?:contact|call)\s+(?:me\s+|us\s+)?by\s+([A-Z][a-z]+)/i);
  if (byMatch?.[1] && !falsePositives.has(byMatch[1].toLowerCase())) {
    return byMatch[1];
  }

  return '';
}

/**
 * Extract location from text using prepositions and known Uganda place names.
 */
export function extractLocation(text: string): { village: string; district: string | null } {
  const t = str(text);
  const lower = t.toLowerCase();
  let village = '';
  let district: string | null = null;

  // Pattern 1: preposition-based "in/at/located in PLACE"
  const locPatterns = [
    /\b(?:in|at|located\s+in|located\s+at|situated\s+in|situated\s+at|plot\s+in|land\s+in|house\s+in|property\s+in)\s+([A-Za-z][\w\s,.\-]+?)(?=\s+(?:at\s+\d+|for\s+sale|for\s+rent|size|\(|\d+\s*(?:million|m\b|acres|UGX)|$|per\s+acres?|negotiable|\.))/i,
    /\b(?:in|at|located\s+in|located\s+at)\s+([A-Za-z][\w\s,.\-]+?)(?=\s*,\s*(?:Gulu|Kampala|Wakiso|Mukono|Jinja|Mbarara|Entebbe|Arua|Lira|Soroti|Mbale|Masaka|Nwoya|Amuru|Omoro|Pader|Fort\s*Portal))/i,
    /\b(?:near|around|close\s+to|adjacent\s+to)\s+([A-Za-z][\w\s,.\-]+?)(?=\s+(?:at|for|on|in|\.|$|,))/i,
    /\b(?:off|along)\s+([A-Za-z][\w\s,.\-]+?)(?=\s+(?:road|highway|street|ave|avenue|\.|,|$))/i,
  ];

  for (const pattern of locPatterns) {
    const match = t.match(pattern);
    if (match?.[1]) {
      const candidate = match[1]
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*(district|sub\s*county|sub-county|village|town|city|parish|ward|division)$/i, '');
      if (candidate.length > 1) {
        village = candidate;
        break;
      }
    }
  }

  // Pattern 2: "PLACE, DISTRICT"
  if (!village) {
    const commaMatch = t.match(/([A-Za-z][\w\s]+?),\s*(Gulu|Nwoya|Amuru|Omoro|Pader|Kampala|Wakiso|Mukono|Entebbe|Jinja|Mbarara|Arua|Lira|Soroti|Mbale|Masaka|Fort\s+Portal)/i);
    if (commaMatch?.[1]) {
      village = commaMatch[1].trim();
    }
  }

  // Pattern 3: direct known Uganda location match
  if (!village) {
    const sorted = Object.entries(UG_LOCATIONS).sort((a, b) => b[0].length - a[0].length);
    for (const [name] of sorted) {
      if (name.length < 3) continue;
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) {
        village = name.charAt(0).toUpperCase() + name.slice(1);
        break;
      }
    }
  }

  // Extract district
  district = ALL_DISTRICTS.find(d =>
    new RegExp(`\\b${d.toLowerCase().replace(' central', '')}\\b`).test(lower)
  ) || null;

  // Fallback district detection from village name
  if (!district) {
    const districtMappings: [RegExp, string][] = [
      [/\b(gulu|pece|laroo|layibi|bardege|unyama|awach|abwoch|patiko|palaro)\b/i, 'Gulu'],
      [/\b(nwoya|anaka|purongo)\b/i, 'Nwoya'],
      [/\b(amuru|atiak|pabbo|mutema|bana)\b/i, 'Amuru'],
      [/\b(omoro|lalogi|koro|atede|atyang)\b/i, 'Omoro'],
      [/\b(pader|agago|angagura)\b/i, 'Pader'],
      [/\b(kampala|nakasero|kololo|ntinda|bugolobi|muyenga|makindye|rubaga|kawempe|nansana|kireka|kira|kyaliwajjala|bweyogerere|kasubi|namungoona|busega)\b/i, 'Kampala Central'],
      [/\b(wakiso|gayaza|matugga|kasangati|najjera|namugongo|kyengera|kitende|bunamwaya|lungujja)\b/i, 'Wakiso'],
      [/\b(mukono|njeru|lugazi|seeta)\b/i, 'Mukono'],
      [/\b(entebbe|kitoro)\b/i, 'Entebbe'],
      [/\b(jinja|bugembe|kakira)\b/i, 'Jinja'],
      [/\b(mbarara|kakoba|nyamitanga|rukuba)\b/i, 'Mbarara'],
      [/\b(arua)\b/i, 'Arua'],
      [/\b(lira)\b/i, 'Lira'],
      [/\b(soroti)\b/i, 'Soroti'],
      [/\b(mbale)\b/i, 'Mbale'],
      [/\b(masaka)\b/i, 'Masaka'],
      [/\b(fort\s+portal)\b/i, 'Fort Portal'],
      [/\b(kitgum)\b/i, 'Pader'],
    ];

    for (const [re, dist] of districtMappings) {
      if (re.test(lower)) {
        district = dist;
        break;
      }
    }
  }

  return { village, district };
}

/**
 * Determine sale status from text.
 */
export function parseStatus(text: string): 'sold' | 'unsold' {
  if (/\b(sold|taken|booked|reserved|unavailable|not\s+available)\b/i.test(str(text))) return 'sold';
  return 'unsold';
}

/**
 * Infer interest level based on price and area.
 */
export function inferInterest(price: number, area: string): 'high' | 'medium' | 'low' {
  const weights: Record<string, number> = {
    'Kampala Central': 1.4, 'Entebbe': 1.1, 'Wakiso': 0.9,
    'Mukono': 0.7, 'Jinja': 0.7, 'Mbarara': 0.6,
    'Arua': 0.55, 'Gulu': 0.5, 'Nwoya': 0.5, 'Amuru': 0.5,
    'Omoro': 0.5, 'Pader': 0.4, 'Lira': 0.45, 'Soroti': 0.4,
    'Mbale': 0.5, 'Masaka': 0.45, 'Fort Portal': 0.55,
  };
  const base = weights[area] ?? 0.7;
  if (base === 0) return 'medium';
  const adj = (price || 0) / base;
  if (adj >= 180) return 'high';
  if (adj >= 80) return 'medium';
  return 'low';
}

/**
 * Generate a human-readable title for the listing.
 */
export function generateTitle(village: string, district: string, sizeSqm: number | null, _sizeDisplay: string): string {
  const loc = village || district;
  if (sizeSqm && sizeSqm >= 4046) {
    const acres = Math.round((sizeSqm / 4046.86) * 10) / 10;
    return `${acres} acre${acres !== 1 ? 's' : ''} in ${loc}`;
  } else if (sizeSqm && sizeSqm > 0) {
    return `${Math.round(sizeSqm)}m² plot in ${loc}`;
  }
  return `Land in ${loc}`;
}

/**
 * Split raw bulk text into individual listing blocks.
 */
export function splitListingsAdvanced(bulk: string): string[] {
  const lines = str(bulk).split(/\r?\n/);
  const blocks: string[] = [];
  let cur = '';

  const isNewStart = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    const lower = t.toLowerCase();
    if (/^[•▪️\-*✓✅🔹🔸➤►▶]\s/.test(t)) return true;
    if (/^\d+[.)]\s/.test(t)) return true;
    if (/^(land|plot|for sale|prime|residential|commercial|house|villa|apartment|acre)/i.test(lower)) return true;

    const hasPrice = /(million|ugx|shs|\d+m\b|\d+\s*million|\d{7,})/i.test(lower);
    const hasSize = /(acres|sqm|m²|x\s*\d+|by\s*\d+|decimals?|hectares?)/i.test(lower);
    const hasLocation = /\b(in|at|located|situated|near|around)\s+[A-Za-z]/i.test(lower);

    return (hasPrice && hasSize) || (hasPrice && hasLocation) || (hasSize && hasLocation);
  };

  for (const line of lines) {
    if (!line.trim()) {
      if (cur) {
        blocks.push(cur);
        cur = '';
      }
      continue;
    }
    if (isNewStart(line) && cur.length > 15) {
      blocks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + ' ' + line : line;
    }
  }
  if (cur) blocks.push(cur);

  // Fallback: double-newline split if only one block found
  if (blocks.length <= 1 && bulk.includes('\n\n')) {
    const db = bulk.split(/\n\s*\n/);
    if (db.length > 1) {
      return db.filter(b => b.trim().length > 10 && /\d/.test(b));
    }
  }

  return blocks.filter(b =>
    b.length > 10 &&
    /\d/.test(b) &&
    /(million|acres|ugx|shs|plot|land|by|x\s*\d+|\d{7,})/i.test(b)
  );
}

/**
 * Check if text contains any property criteria.
 */
export function hasPropertyCriteria(text: string): {
  hasSize: boolean;
  hasLocation: boolean;
  hasPrice: boolean;
  hasAgent: boolean;
} {
  const lower = str(text).toLowerCase();

  const hasSize = SIZE_PATTERNS.some(p => p.regex.test(lower));
  const hasLocation =
    LOCATION_PREPOSITIONS.some(prep =>
      new RegExp(`\\b${prep}\\s+[A-Za-z]`, 'i').test(lower)
    ) ||
    Object.keys(UG_LOCATIONS).some(loc =>
      new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)
    );
  const hasPrice = PRICE_PATTERNS.some(p => p.regex.test(lower));
  const hasAgent = AGENT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));

  return { hasSize, hasLocation, hasPrice, hasAgent };
}

/**
 * Full parse of a text block into structured property data.
 */
export function parseFull(
  text: string,
  fallbackDistrict = 'Gulu'
): {
  info: ParsedInfo;
  criteria: ReturnType<typeof hasPropertyCriteria>;
} {
  const safeText = str(text);
  const { village, district } = extractLocation(safeText);
  const price = parsePrice(safeText);
  const { sizeSqm, sizeDisplay } = parseSize(safeText);
  const status = parseStatus(safeText);
  const phone = extractPhone(safeText);
  const agent = extractAgent(safeText);
  const effectiveDistrict = district || fallbackDistrict || 'Gulu';
  const interest = price > 0 ? inferInterest(price, effectiveDistrict) : 'medium';
  const title = generateTitle(village, effectiveDistrict, sizeSqm, sizeDisplay || '');

  const info: ParsedInfo = {
    village,
    district: effectiveDistrict,
    price,
    sizeSqm,
    sizeDisplay: sizeDisplay || (sizeSqm ? `${Math.round(sizeSqm)}m²` : 'unknown'),
    status,
    phone,
    agent,
    interest,
    title,
  };

  return { info, criteria: hasPropertyCriteria(safeText) };
}

/**
 * Separate lines with property criteria from lines without.
 */
export function separatePropertyLines(text: string): {
  propertyLines: string[];
  otherLines: string[];
} {
  const lines = str(text).split(/\r?\n/).filter(l => l.trim());
  const propertyLines: string[] = [];
  const otherLines: string[] = [];

  // Block-based first
  const blocks = splitListingsAdvanced(text);
  if (blocks.length > 1) {
    for (const block of blocks) {
      const c = hasPropertyCriteria(block);
      if (c.hasSize || c.hasPrice || (c.hasLocation && (c.hasSize || c.hasPrice))) {
        propertyLines.push(block);
      } else {
        otherLines.push(block);
      }
    }
  } else {
    for (const line of lines) {
      const c = hasPropertyCriteria(line);
      if (c.hasSize || c.hasPrice || (c.hasLocation && c.hasPrice)) {
        propertyLines.push(line);
      } else {
        otherLines.push(line);
      }
    }
  }

  return { propertyLines, otherLines };
}
