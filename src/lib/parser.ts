import {
  UG_LOCATIONS,
  ALL_DISTRICTS,
  SIZE_PATTERNS,
  PRICE_PATTERNS,
  PHONE_PATTERNS,
  AGENT_NAME_PATTERN,
} from './ugandaData';
import type { ParsedInfo } from '@/types';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type LocationResult = { village: string; district: string | null };
type SizeResult = { sizeSqm: number | null; sizeDisplay: string };
type CriteriaResult = { hasSize: boolean; hasLocation: boolean; hasPrice: boolean; hasAgent: boolean };
type SplitResult = { propertyLines: string[]; otherLines: string[] };
type ParseResult = { info: ParsedInfo; criteria: CriteriaResult };

// =============================================================================
// CONSTANTS & COMPILED REGEX
// =============================================================================

const SOLD_PATTERN = /\b(sold|taken|booked|reserved|unavailable|not\s+available)\b/i;
const BARE_PRICE_PATTERN = /\b(\d{7,})\b/;
const WHITESPACE_PATTERN = /\s+/g;
const DISTRICT_SUFFIX_PATTERN = /\s*(district|sub\s*county|sub-county|village|town|city|parish|ward|division)$/i;

const FALSE_POSITIVES = new Set([
  'me', 'us', 'now', 'today', 'for', 'the', 'this', 'that',
  'and', 'or', 'him', 'her', 'them', 'you', 'more', 'info',
  'details', 'free', 'sale', 'rent', 'land', 'plot', 'acre',
  'acres', 'million', 'size', 'price', 'contact', 'call',
]);

const LOCATION_PATTERNS: RegExp[] = [
  /\b(?:in|at|located\s+in|located\s+at|situated\s+in|situated\s+at)\s+([A-Z][\w\s,.\-]{1,50}?)(?=\s+(?:at\s+\d|for\s+|size|[(\d]|$|per\s+acre|negotiable|\.))/i,
  /\b(?:near|around|close\s+to|adjacent\s+to)\s+([A-Z][\w\s,.\-]{1,40}?)(?=\s+(?:at|for|on|in|[.,]|$))/i,
  /\b(?:off|along)\s+([A-Z][\w\s,.\-]{1,30}?)(?=\s+(?:road|highway|street|ave|avenue|[.,]|$))/i,
  /\b(?:plot\s+in|land\s+in|house\s+in|property\s+in)\s+([A-Z][\w\s,.\-]{1,50}?)(?=\s+(?:at|for|[(\d]|$|\.))/i,
];

const COMMA_LOCATION_PATTERN = /\b([A-Z][\w\s]{2,40}?),\s*(Gulu|Nwoya|Amuru|Omoro|Pader|Kampala|Wakiso|Mukono|Entebbe|Jinja|Mbarara|Arua|Lira|Soroti|Mbale|Masaka|Fort\s+Portal)\b/i;

const AGENT_ROLE_PATTERN = /\b(?:agent|realtor|broker|manager|owner|contact|landlord)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i;
const AGENT_BY_PATTERN = /\b(?:contact|call|reach)\s+(?:me\s+|us\s+)?(?:on\s+)?(?:by\s+)?([A-Z][a-z]+)\b/i;

const INTEREST_WEIGHTS: Record<string, number> = {
  'Kampala Central': 1.4, 'Entebbe': 1.1, 'Wakiso': 0.9,
  'Mukono': 0.7, 'Jinja': 0.7, 'Mbarara': 0.6, 'Arua': 0.55,
  'Gulu': 0.5, 'Nwoya': 0.5, 'Amuru': 0.5, 'Omoro': 0.5,
  'Pader': 0.4, 'Lira': 0.45, 'Soroti': 0.4, 'Mbale': 0.5,
  'Masaka': 0.45, 'Fort Portal': 0.55,
};

const DISTRICT_MAPPINGS: [RegExp, string][] = [
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

// Cache for expensive operations
const locationCache = new Map<string, LocationResult>();
const MAX_CACHE_SIZE = 1000;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  return String(v);
}

function cleanText(text: string): string {
  return text.replace(WHITESPACE_PATTERN, ' ').trim();
}

function cacheLocation(key: string, result: LocationResult): void {
  if (locationCache.size >= MAX_CACHE_SIZE) {
    // Clear oldest half of cache
    const entries = Array.from(locationCache.keys());
    entries.slice(0, Math.floor(entries.length / 2)).forEach(k => locationCache.delete(k));
  }
  locationCache.set(key, result);
}

// =============================================================================
// SIZE PARSING
// =============================================================================

export function parseSize(text: string): SizeResult {
  const raw = str(text);
  if (!raw) return { sizeSqm: null, sizeDisplay: '' };

  const lower = raw.toLowerCase();

  for (const pattern of SIZE_PATTERNS) {
    // Reset global regex state
    if (pattern.regex.global) pattern.regex.lastIndex = 0;

    const match = pattern.regex.exec(lower);
    if (!match || !match[0]) continue;

    const result = parseSizeMatch(pattern.type, match);
    if (result.sizeSqm && result.sizeSqm > 0) {
      return result;
    }
  }

  return { sizeSqm: null, sizeDisplay: '' };
}

function parseSizeMatch(type: string, match: RegExpExecArray): SizeResult {
  switch (type) {
    case 'dimensions':
      return parseDimensionsSize(match);
    case 'acres':
      return parseAcresSize(match);
    case 'sqm':
      return parseSqmSize(match);
    case 'hectares':
      return parseHectaresSize(match);
    case 'decimals':
      return parseDecimalsSize(match);
    default:
      return { sizeSqm: null, sizeDisplay: '' };
  }
}

function parseDimensionsSize(match: RegExpExecArray): SizeResult {
  const dim1 = parseFloat(match[1]);
  const dim2 = parseFloat(match[2]);
  
  if (!dim1 || !dim2 || dim1 <= 0 || dim2 <= 0) {
    return { sizeSqm: null, sizeDisplay: '' };
  }

  const isFeet = /ft|feet|'/i.test(match[0]);
  
  if (isFeet) {
    const sizeSqm = Math.round(dim1 * dim2 * 0.092903 * 100) / 100;
    return {
      sizeSqm,
      sizeDisplay: `${dim1}×${dim2}ft (~${Math.round(sizeSqm)}m²)`,
    };
  }
  
  const sizeSqm = Math.round(dim1 * dim2 * 100) / 100;
  return {
    sizeSqm,
    sizeDisplay: `${dim1}×${dim2}m (${Math.round(sizeSqm)}m²)`,
  };
}

function parseAcresSize(match: RegExpExecArray): SizeResult {
  const raw = (match[1] || '').toLowerCase().trim();
  const acres = raw === 'half' ? 0.5 : parseFloat(raw);
  
  if (!acres || acres <= 0) return { sizeSqm: null, sizeDisplay: '' };
  
  const sizeSqm = Math.round(acres * 4046.86);
  return {
    sizeSqm,
    sizeDisplay: `${acres} acre${acres !== 1 ? 's' : ''} (~${sizeSqm}m²)`,
  };
}

function parseSqmSize(match: RegExpExecArray): SizeResult {
  const val = parseFloat(match[1]);
  if (!val || val <= 0) return { sizeSqm: null, sizeDisplay: '' };
  
  const sizeSqm = Math.round(val);
  return { sizeSqm, sizeDisplay: `${sizeSqm}m²` };
}

function parseHectaresSize(match: RegExpExecArray): SizeResult {
  const ha = parseFloat(match[1]);
  if (!ha || ha <= 0) return { sizeSqm: null, sizeDisplay: '' };
  
  const sizeSqm = Math.round(ha * 10000);
  return { sizeSqm, sizeDisplay: `${ha} ha (${sizeSqm}m²)` };
}

function parseDecimalsSize(match: RegExpExecArray): SizeResult {
  const dec = parseFloat(match[1]);
  if (!dec || dec <= 0) return { sizeSqm: null, sizeDisplay: '' };
  
  const sizeSqm = Math.round(dec * 404.686);
  return {
    sizeSqm,
    sizeDisplay: `${dec} decimal${dec !== 1 ? 's' : ''} (~${sizeSqm}m²)`,
  };
}

// =============================================================================
// PRICE PARSING
// =============================================================================

export function parsePrice(text: string): number {
  const raw = str(text);
  if (!raw) return 0;

  // Normalize: remove commas and collapse whitespace
  const normalized = raw.toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').trim();

  // Try structured patterns first
  for (const pattern of PRICE_PATTERNS) {
    if (pattern.regex.global) pattern.regex.lastIndex = 0;

    const match = pattern.regex.exec(normalized);
    if (!match?.[1]) continue;

    const val = parseFloat(match[1]);
    if (!val || val <= 0) continue;

    if (pattern.multiplier !== null) {
      const result = val * pattern.multiplier;
      if (result > 0 && isFinite(result)) {
        return Math.round(result * 100) / 100;
      }
    } else {
      // Raw UGX: if value > 10000, it's in shillings, convert to millions
      const result = val > 10000 ? val / 1_000_000 : val;
      if (result > 0 && isFinite(result)) {
        return Math.round(result * 100) / 100;
      }
    }
  }

  // Fallback: bare large number (7+ digits = 10M+ UGX)
  const bareMatch = BARE_PRICE_PATTERN.exec(normalized);
  if (bareMatch?.[1]) {
    const val = parseInt(bareMatch[1], 10);
    if (val >= 10_000_000) {
      return Math.round((val / 1_000_000) * 100) / 100;
    }
  }

  return 0;
}

// =============================================================================
// PHONE EXTRACTION
// =============================================================================

export function extractPhone(text: string): string {
  const t = str(text).trim();
  if (!t) return '';

  for (const pattern of PHONE_PATTERNS) {
    const match = t.match(pattern);
    if (match?.[0]) {
      // Remove formatting characters
      return match[0].replace(/[\s\-\(\)]/g, '');
    }
  }
  
  return '';
}

// =============================================================================
// AGENT EXTRACTION
// =============================================================================

export function extractAgent(text: string): string {
  const t = str(text).trim();
  if (!t) return '';

  // Pattern 1: "call/contact/whatsapp NAME"
  const agentMatch = AGENT_NAME_PATTERN.exec(t);
  if (agentMatch?.[1]) {
    const name = cleanText(agentMatch[1]);
    if (isValidName(name)) return name;
  }

  // Pattern 2: "agent/realtor/broker: NAME"
  const roleMatch = AGENT_ROLE_PATTERN.exec(t);
  if (roleMatch?.[1]) {
    const name = roleMatch[1].trim();
    if (isValidName(name)) return name;
  }

  // Pattern 3: "contact/call by NAME"
  const byMatch = AGENT_BY_PATTERN.exec(t);
  if (byMatch?.[1]) {
    const name = byMatch[1].trim();
    if (isValidName(name)) return name;
  }

  return '';
}

function isValidName(name: string): boolean {
  if (name.length < 2) return false;
  if (!/^[A-Z]/.test(name)) return false;
  if (FALSE_POSITIVES.has(name.toLowerCase())) return false;
  if (/\d/.test(name)) return false;
  return true;
}

// =============================================================================
// LOCATION EXTRACTION
// =============================================================================

export function extractLocation(text: string): LocationResult {
  const t = str(text).trim();
  if (!t) return { village: '', district: null };

  // Check cache
  const cacheKey = t.slice(0, 200);
  const cached = locationCache.get(cacheKey);
  if (cached) return cached;

  const lower = t.toLowerCase();
  let village = '';
  let district: string | null = null;

  // Method 1: Preposition-based extraction
  village = extractVillageByPreposition(t);
  
  // Method 2: "PLACE, DISTRICT" format
  if (!village) {
    village = extractVillageByComma(t);
  }
  
  // Method 3: Direct location match
  if (!village) {
    village = extractVillageByDirectMatch(lower);
  }

  // Extract district from ALL_DISTRICTS
  district = ALL_DISTRICTS.find(d => {
    const distLower = d.toLowerCase().replace(' central', '');
    return lower.includes(distLower);
  }) || null;

  // Fallback: infer district from village
  if (!district) {
    district = inferDistrictFromVillage(lower);
  }

  const result: LocationResult = { village, district };
  cacheLocation(cacheKey, result);
  
  return result;
}

function extractVillageByPreposition(text: string): string {
  for (const pattern of LOCATION_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const candidate = match[1]
        .trim()
        .replace(WHITESPACE_PATTERN, ' ')
        .replace(DISTRICT_SUFFIX_PATTERN, '')
        .trim();
      
      if (candidate.length > 1 && /^[A-Z]/.test(candidate)) {
        return candidate;
      }
    }
  }
  return '';
}

function extractVillageByComma(text: string): string {
  const match = COMMA_LOCATION_PATTERN.exec(text);
  if (match?.[1]) {
    return match[1].trim();
  }
  return '';
}

function extractVillageByDirectMatch(lower: string): string {
  // Sort by length descending for greedy matching
  const sorted = Object.entries(UG_LOCATIONS)
    .sort((a, b) => b[0].length - a[0].length);
  
  for (const [name] of sorted) {
    if (name.length < 3) continue;
    if (lower.includes(name.toLowerCase())) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  
  return '';
}

function inferDistrictFromVillage(lower: string): string | null {
  for (const [pattern, district] of DISTRICT_MAPPINGS) {
    if (pattern.test(lower)) {
      return district;
    }
  }
  return null;
}

// =============================================================================
// STATUS PARSING
// =============================================================================

export function parseStatus(text: string): 'sold' | 'unsold' {
  return SOLD_PATTERN.test(str(text)) ? 'sold' : 'unsold';
}

// =============================================================================
// INTEREST INFERENCE
// =============================================================================

export function inferInterest(price: number, area: string): 'high' | 'medium' | 'low' {
  if (!price || price <= 0) return 'medium';

  const weight = INTEREST_WEIGHTS[area] ?? 0.7;
  const adjusted = price / weight;

  if (adjusted >= 180) return 'high';
  if (adjusted >= 80) return 'medium';
  return 'low';
}

// =============================================================================
// TITLE GENERATION
// =============================================================================

export function generateTitle(village: string, district: string, sizeSqm: number | null): string {
  const location = village || district || 'Unknown';
  
  if (!sizeSqm || sizeSqm <= 0) {
    return `Land in ${location}`;
  }

  if (sizeSqm >= 4046) {
    const acres = Math.round((sizeSqm / 4046.86) * 10) / 10;
    return `${acres} acre${acres !== 1 ? 's' : ''} in ${location}`;
  }

  return `${Math.round(sizeSqm)}m² plot in ${location}`;
}

// =============================================================================
// BULK TEXT SPLITTING
// =============================================================================

export function splitListingsAdvanced(bulk: string): string[] {
  const text = str(bulk).trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/);
  const blocks: string[] = [];
  let currentBlock = '';

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Empty line = block separator
    if (!trimmed) {
      if (currentBlock) {
        blocks.push(currentBlock.trim());
        currentBlock = '';
      }
      continue;
    }

    // Check if this line starts a new listing
    if (isNewListingStart(trimmed) && currentBlock.length > 15) {
      blocks.push(currentBlock.trim());
      currentBlock = trimmed;
    } else {
      currentBlock = currentBlock ? `${currentBlock} ${trimmed}` : trimmed;
    }
  }

  // Don't forget the last block
  if (currentBlock.trim()) {
    blocks.push(currentBlock.trim());
  }

  // If no blocks found, try splitting by double newlines
  if (blocks.length === 0 && text.includes('\n\n')) {
    return text
      .split(/\n\s*\n/)
      .map(b => b.trim())
      .filter(b => isValidListingBlock(b));
  }

  return blocks.filter(b => isValidListingBlock(b));
}

function isNewListingStart(line: string): boolean {
  const t = line.trim();
  const lower = t.toLowerCase();

  // Bullet points or numbered lists
  if (/^[•▪️\-*✓✅🔹🔸➤►▶]\s/.test(t)) return true;
  if (/^\d{1,2}[.)]\s/.test(t)) return true;

  // Common property listing starters
  if (/^(land|plot|for\s+sale|prime|residential|commercial|house|villa|apartment|acre|building)/i.test(lower)) {
    return true;
  }

  // Check for combination of property indicators
  const hasPrice = /(?:million|ugx|shs|\d{1,3}m\b|\d+\s*million|\b\d{7,}\b)/i.test(lower);
  const hasSize = /(?:acres?|sqm|m²|\d+\s*[x×]\s*\d+|\bby\b|\d+\s*decimals?|\d+\s*hectares?)/i.test(lower);
  const hasLocation = /\b(?:in|at|located|situated|near|around|along|off)\s+[A-Z]/i.test(lower);

  // Two out of three indicators = likely new listing
  const indicators = [hasPrice, hasSize, hasLocation].filter(Boolean).length;
  return indicators >= 2;
}

function isValidListingBlock(block: string): boolean {
  if (block.length < 15) return false;
  if (!/\d/.test(block)) return false;
  
  return /(?:million|acres?|ugx|shs|plot|land|by|\d+\s*[x×]\s*\d+|\d{7,})/i.test(block);
}

// =============================================================================
// PROPERTY CRITERIA DETECTION
// =============================================================================

export function hasPropertyCriteria(text: string): CriteriaResult {
  const lower = str(text).toLowerCase().trim();
  
  if (!lower) {
    return { hasSize: false, hasLocation: false, hasPrice: false, hasAgent: false };
  }

  const hasSize = SIZE_PATTERNS.some(p => p.regex.test(lower));
  
  // FIX: UG_LOCATIONS is an object, use Object.keys to get an array of names
  const locationNames = Object.keys(UG_LOCATIONS);
  const hasLocation = (
    /\b(?:in|at|located|situated|near|around|off|along)\s+[a-z]/i.test(lower) ||
    locationNames.some(loc => lower.includes(loc.toLowerCase()))
  );
  
  const hasPrice = PRICE_PATTERNS.some(p => p.regex.test(lower));
  
  const hasAgent = /\b(?:call|contact|whatsapp|agent|realtor|broker|manager|owner|landlord)\b/i.test(lower);

  return { hasSize, hasLocation, hasPrice, hasAgent };
}

// =============================================================================
// FULL PARSE
// =============================================================================

export function parseFull(text: string, fallbackDistrict = 'Gulu'): ParseResult {
  const safeText = str(text).trim();
  
  // Handle empty input
  if (!safeText) {
    return {
      info: createEmptyInfo(fallbackDistrict),
      criteria: { hasSize: false, hasLocation: false, hasPrice: false, hasAgent: false },
    };
  }

  // Extract all information
  const { village, district } = extractLocation(safeText);
  const price = parsePrice(safeText);
  const { sizeSqm, sizeDisplay } = parseSize(safeText);
  const status = parseStatus(safeText);
  const phone = extractPhone(safeText);
  const agent = extractAgent(safeText);
  
  const effectiveDistrict = district || fallbackDistrict;
  const interest = price > 0 ? inferInterest(price, effectiveDistrict) : 'medium';
  const title = generateTitle(village, effectiveDistrict, sizeSqm);

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

  return {
    info,
    criteria: hasPropertyCriteria(safeText),
  };
}

function createEmptyInfo(district: string): ParsedInfo {
  return {
    village: '',
    district,
    price: 0,
    sizeSqm: null,
    sizeDisplay: 'unknown',
    status: 'unsold',
    phone: '',
    agent: '',
    interest: 'medium',
    title: `Land in ${district}`,
  };
}

// =============================================================================
// LINE SEPARATION
// =============================================================================

export function separatePropertyLines(text: string): SplitResult {
  const blocks = splitListingsAdvanced(text);
  
  const propertyLines: string[] = [];
  const otherLines: string[] = [];

  if (blocks.length > 1) {
    // Process block by block
    for (const block of blocks) {
      const criteria = hasPropertyCriteria(block);
      if (criteria.hasSize || criteria.hasPrice || (criteria.hasLocation && (criteria.hasSize || criteria.hasPrice))) {
        propertyLines.push(block);
      } else {
        otherLines.push(block);
      }
    }
  } else {
    // Fall back to line-by-line processing
    const lines = str(text).split(/\r?\n/).filter(l => l.trim());
    
    for (const line of lines) {
      const criteria = hasPropertyCriteria(line);
      if (criteria.hasSize || criteria.hasPrice || (criteria.hasLocation && criteria.hasPrice)) {
        propertyLines.push(line);
      } else {
        otherLines.push(line);
      }
    }
  }

  return { propertyLines, otherLines };
}

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

export function clearLocationCache(): void {
  locationCache.clear();
}

export function getCacheStats(): { size: number } {
  return { size: locationCache.size };
}