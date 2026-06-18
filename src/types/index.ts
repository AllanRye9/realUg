export interface Listing {
  id: number;
  title: string;
  priceUGX: number;
  areaName: string;
  suburb: string;
  status: 'sold' | 'unsold';
  interest: 'high' | 'medium' | 'low';
  size: string;
  lat: number;
  lng: number;
  posts: number;
  agent: string;
  contact: string;
  notes: string;
  village: string;
  district: string;
  _improvements?: string[];
  _confidence?: number;
  _geocoded?: boolean;
  _geocodeSource?: 'osm' | 'local' | 'fallback';
}

export interface ParsedBlock {
  text: string;
  enhanced: ParsedInfo;
  improvements: string[];
  score: number;
}

export interface ParsedInfo {
  village: string;
  district: string;
  price: number;
  sizeSqm: number | null;
  sizeDisplay: string;
  status: 'sold' | 'unsold';
  phone: string;
  agent: string;
  interest: 'high' | 'medium' | 'low';
  title: string;
  confidence?: number;
  priceFromRule?: boolean;
  ruleConfidence?: number;
  sizeFromCorrelation?: boolean;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  source: 'osm' | 'local' | 'fallback';
  displayName?: string;
}

export interface LearningKnowledge {
  patterns: Record<string, PatternData>;
  correlations: Correlation[];
  marketTrends: MarketTrend[];
  priceRanges: Record<string, PriceRange>;
  parseRules: ParseRule[];
  geospatialCache: Record<string, GeoCacheEntry>;
  seasonalTrends: Record<string, Record<number, SeasonEntry>>;
  qualityScore: number;
  processedCount: number;
  version: string;
  lastUpdated: number;
  totalPatterns: number;
}

export interface PatternData {
  count: number;
  avgPrice: number;
  districts: Record<string, number>;
  qualityTotal: number;
  confidence: number;
  context: string[];
}

export interface Correlation {
  word1: string;
  word2: string;
  strength: number;
  qualityTotal: number;
  confidence: number;
}

export interface MarketTrend {
  district: string;
  trend: 'rising' | 'falling' | 'stable';
  confidence: number;
  qualityTotal: number;
  prices: number[];
}

export interface PriceRange {
  min: number;
  max: number;
  avg: number;
  count: number;
  prices: number[];
  qualityTotal: number;
  stdDev: number;
}

export interface ParseRule {
  patterns: string[];
  district: string;
  avgPrice: number;
  count: number;
  confidence: number;
}

export interface GeoCacheEntry {
  lat: number;
  lng: number;
  district: string;
  confidence: number;
}

export interface SeasonEntry {
  total: number;
  count: number;
}

export interface LearningSummary {
  totalListings: number;
  districts: number;
  overallAvg: number;
  qualityScore: number;
  patterns: number;
  parseRules: number;
}

export interface DistrictStats {
  count: number;
  sold: number;
  totalPrice: number;
  minPrice: number;
  maxPrice: number;
  prices: number[];
  highInt: number;
  villages: Set<string>;
}

export interface UnverifiedLocation {
  id: number;
  originalText: string;
  extractedLocation: string;
  reason: string;
  listing?: Partial<Listing>;
  attemptedQueries?: string[];
}
