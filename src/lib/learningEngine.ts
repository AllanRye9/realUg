import type {
  LearningKnowledge,
  LearningSummary,
  Listing,
  PatternData,
} from '@/types';
import { WEIGHTS } from './ugandaData';

function safeJSONParse<T>(str: string, defaultVal: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return defaultVal;
  }
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, val: string): boolean {
  try {
    localStorage.setItem(key, val);
    return true;
  } catch (e) {
    // localStorage may be full or unavailable (private browsing, quota exceeded)
    console.warn('[learningEngine] localStorage write failed:', (e as Error)?.message);
    return false;
  }
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

const STORAGE_KEY = 'uganda_learning_engine_v4';

// Maximum sizes to prevent unbounded memory growth
const MAX_PRICES_PER_DISTRICT = 100;
const MAX_TREND_PRICES = 20;
const MAX_CORRELATIONS = 2000;
const MAX_PARSE_RULES = 500;
const MAX_CONTEXT_PER_PATTERN = 5;
const MAX_PATTERN_KEYS = 5000;

export class LearningEngine {
  knowledge: LearningKnowledge;

  constructor() {
    this.knowledge = this._emptyKnowledge();
    this.load();
  }

  private _emptyKnowledge(): LearningKnowledge {
    return {
      patterns: {},
      correlations: [],
      marketTrends: [],
      priceRanges: {},
      parseRules: [],
      geospatialCache: {},
      seasonalTrends: {},
      qualityScore: 0,
      processedCount: 0,
      version: '4.0-map-intelligence',
      lastUpdated: Date.now(),
      totalPatterns: 0,
    };
  }

  reset() {
    this.knowledge = this._emptyKnowledge();
    this.save();
  }

  load() {
    try {
      const raw = safeLocalStorageGet(STORAGE_KEY);
      if (!raw) return;
      const parsed = safeJSONParse<Partial<LearningKnowledge> | null>(raw, null);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.reset();
        return;
      }
      if (parsed.patterns && typeof parsed.patterns === 'object')
        this.knowledge.patterns = parsed.patterns;
      if (Array.isArray(parsed.correlations))
        this.knowledge.correlations = parsed.correlations;
      if (Array.isArray(parsed.marketTrends))
        this.knowledge.marketTrends = parsed.marketTrends;
      if (parsed.priceRanges && typeof parsed.priceRanges === 'object')
        this.knowledge.priceRanges = parsed.priceRanges;
      if (Array.isArray(parsed.parseRules))
        this.knowledge.parseRules = parsed.parseRules;
      if (parsed.geospatialCache && typeof parsed.geospatialCache === 'object')
        this.knowledge.geospatialCache = parsed.geospatialCache;
      if (parsed.seasonalTrends && typeof parsed.seasonalTrends === 'object')
        this.knowledge.seasonalTrends = parsed.seasonalTrends;
      this.knowledge.qualityScore = toNum(parsed.qualityScore, 0);
      this.knowledge.processedCount = toNum(parsed.processedCount, 0);
      this.knowledge.lastUpdated = toNum(parsed.lastUpdated, Date.now());
      this.knowledge.totalPatterns = Object.keys(this.knowledge.patterns).length;
    } catch {
      this.reset();
    }
  }

  save() {
    this.knowledge.lastUpdated = Date.now();
    this.knowledge.totalPatterns = Object.keys(this.knowledge.patterns).length;
    safeLocalStorageSet(STORAGE_KEY, JSON.stringify(this.knowledge));
  }

  learn(listing: Listing, qualityWeight = 1.0) {
    // Guard: reject invalid input
    if (!listing || !listing.title || !listing.areaName) return;
    const price = toNum(listing.priceUGX, 0);
    if (!isFinite(price) || price < 0) return;
    const qw = toNum(qualityWeight, 1.0);

    this.knowledge.processedCount++;
    const prev = this.knowledge.qualityScore;
    const count = this.knowledge.processedCount;
    this.knowledge.qualityScore = (prev * (count - 1) + qw) / count;

    // Tokenise text — cap at 25 meaningful words
    const text = [listing.title, listing.notes || '', listing.size || '']
      .join(' ')
      .toLowerCase();
    const words = text
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 3)
      .slice(0, 25);

    // Guard pattern count growth
    const currentKeys = Object.keys(this.knowledge.patterns).length;

    words.forEach(word => {
      if (!this.knowledge.patterns[word]) {
        // Don't grow patterns beyond limit
        if (currentKeys >= MAX_PATTERN_KEYS) return;
        this.knowledge.patterns[word] = {
          count: 0,
          avgPrice: 0,
          districts: {},
          qualityTotal: 0,
          confidence: 0.1,
          context: [],
        };
      }
      const p = this.knowledge.patterns[word] as PatternData;
      p.count++;
      p.qualityTotal = toNum(p.qualityTotal) + qw;
      p.confidence = Math.min(1, p.confidence + 0.05 * qw);
      p.avgPrice = (p.avgPrice * (p.count - 1) + price) / p.count;
      if (!p.districts[listing.areaName]) p.districts[listing.areaName] = 0;
      p.districts[listing.areaName]++;
      if (words.length > 3) {
        const ctx = words[0];
        if (!p.context.includes(ctx)) {
          p.context.push(ctx);
          if (p.context.length > MAX_CONTEXT_PER_PATTERN) p.context.shift();
        }
      }
    });

    // Price ranges per district
    if (!this.knowledge.priceRanges[listing.areaName]) {
      this.knowledge.priceRanges[listing.areaName] = {
        min: Infinity,
        max: 0,
        avg: 0,
        count: 0,
        prices: [],
        qualityTotal: 0,
        stdDev: 0,
      };
    }
    const pr = this.knowledge.priceRanges[listing.areaName];
    pr.min = Math.min(isFinite(pr.min) ? pr.min : price, price);
    pr.max = Math.max(pr.max, price);
    pr.avg = (pr.avg * pr.count + price) / (pr.count + 1);
    pr.count++;
    pr.prices.push(price);
    if (pr.prices.length > MAX_PRICES_PER_DISTRICT) pr.prices.shift();
    pr.qualityTotal = toNum(pr.qualityTotal) + qw;
    if (pr.prices.length > 1) {
      const mean = pr.prices.reduce((a, b) => a + b, 0) / pr.prices.length;
      pr.stdDev = Math.sqrt(
        pr.prices.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / pr.prices.length
      );
    }

    // Word correlations — cap total
    if (this.knowledge.correlations.length < MAX_CORRELATIONS) {
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < Math.min(i + 4, words.length); j++) {
          const w1 = words[i];
          const w2 = words[j];
          if (w1 === w2) continue;
          let corr = this.knowledge.correlations.find(
            c => (c.word1 === w1 && c.word2 === w2) || (c.word1 === w2 && c.word2 === w1)
          );
          if (!corr) {
            if (this.knowledge.correlations.length >= MAX_CORRELATIONS) break;
            corr = { word1: w1, word2: w2, strength: 0, qualityTotal: 0, confidence: 0.1 };
            this.knowledge.correlations.push(corr);
          }
          corr.strength++;
          corr.qualityTotal = toNum(corr.qualityTotal) + qw;
          corr.confidence = Math.min(1, corr.confidence + 0.03 * qw);
        }
      }
    }

    // Parse rules — cap total
    if (words.length > 0 && price > 0 && this.knowledge.parseRules.length < MAX_PARSE_RULES) {
      const existing = this.knowledge.parseRules.find(
        r => r.patterns.some(p => words.slice(0, 3).includes(p)) && r.district === listing.areaName
      );
      if (existing) {
        existing.count++;
        existing.avgPrice = (existing.avgPrice * (existing.count - 1) + price) / existing.count;
        existing.confidence = Math.min(1, existing.confidence + 0.1 * qw);
      } else {
        this.knowledge.parseRules.push({
          patterns: words.slice(0, 5),
          district: listing.areaName,
          avgPrice: price,
          count: 1,
          confidence: 0.3 * qw,
        });
      }
    }

    // Market trends
    let trend = this.knowledge.marketTrends.find(t => t.district === listing.areaName);
    if (!trend) {
      trend = {
        district: listing.areaName,
        trend: 'stable',
        confidence: 0.2,
        qualityTotal: 0,
        prices: [],
      };
      this.knowledge.marketTrends.push(trend);
    }
    trend.confidence = Math.min(1, trend.confidence + 0.08 * qw);
    trend.qualityTotal = toNum(trend.qualityTotal) + qw;
    trend.prices.push(price);
    if (trend.prices.length > MAX_TREND_PRICES) trend.prices.shift();
    if (trend.prices.length >= 5) {
      const half = Math.floor(trend.prices.length / 2);
      const first = trend.prices.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const second = trend.prices.slice(half).reduce((a, b) => a + b, 0) / (trend.prices.length - half);
      trend.trend = second > first * 1.05 ? 'rising' : second < first * 0.95 ? 'falling' : 'stable';
    }

    // Seasonal trends
    const month = new Date().getMonth();
    if (!this.knowledge.seasonalTrends[listing.areaName])
      this.knowledge.seasonalTrends[listing.areaName] = {};
    if (!this.knowledge.seasonalTrends[listing.areaName][month])
      this.knowledge.seasonalTrends[listing.areaName][month] = { total: 0, count: 0 };
    const st = this.knowledge.seasonalTrends[listing.areaName][month];
    st.total += price;
    st.count++;

    // Geospatial cache from verified listings
    if (listing.village && listing.lat && listing.lng && listing._geocoded) {
      this.knowledge.geospatialCache[String(listing.village).toLowerCase()] = {
        lat: toNum(listing.lat, 0),
        lng: toNum(listing.lng, 0),
        district: listing.areaName,
        confidence: 0.9,
      };
    }

    this.save();
  }

  inferInterest(price: number, area: string): 'high' | 'medium' | 'low' {
    const base = (WEIGHTS as Record<string, number>)[area] ?? 0.7;
    const adj = toNum(price, 0) / (base || 0.7);
    if (adj >= 180) return 'high';
    if (adj >= 80) return 'medium';
    return 'low';
  }

  applyPatternsToRawData(text: string): {
    enhanced: Record<string, unknown>;
    improvements: string[];
  } {
    const lower = String(text || '').toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 3);
    const improvements: string[] = [];
    const enhanced: Record<string, unknown> = {};

    let bestMatch: { pattern: string; data: PatternData } | null = null;
    let bestScore = 0;
    for (const [pattern, data] of Object.entries(this.knowledge.patterns)) {
      if (words.includes(pattern) && (data as PatternData).confidence > 0.3) {
        const score = (data as PatternData).confidence * (data as PatternData).count;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { pattern, data: data as PatternData };
        }
      }
    }

    if (bestMatch) {
      const districts = Object.keys(bestMatch.data.districts || {});
      if (districts.length > 0) {
        enhanced._inferredDistrict = districts.reduce((a, b) =>
          (bestMatch!.data.districts[a] || 0) > (bestMatch!.data.districts[b] || 0) ? a : b
        );
        enhanced._confidence = bestMatch.data.confidence;
        improvements.push(`Pattern match (${Math.round(bestMatch.data.confidence * 100)}% confidence)`);
      }
    }

    for (const rule of this.knowledge.parseRules) {
      if (rule.confidence > 0.4 && rule.patterns.some(p => words.includes(p))) {
        enhanced._estimatedPrice = rule.avgPrice * 0.7;
        enhanced._priceFromRule = true;
        enhanced._ruleConfidence = rule.confidence;
        improvements.push(`Price estimated from rule (${Math.round(rule.confidence * 100)}% confidence)`);
        break;
      }
    }

    if (words.length > 0) {
      for (const corr of this.knowledge.correlations) {
        if (corr.confidence > 0.5 && (words.includes(corr.word1) || words.includes(corr.word2))) {
          const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(acres|sqm|m²|x\s*\d+)/i);
          if (sizeMatch) {
            enhanced._inferredSize = sizeMatch[0];
            enhanced._sizeFromCorrelation = true;
            improvements.push('Size inferred from correlation');
          }
          break;
        }
      }
    }

    return { enhanced, improvements };
  }

  getSummary(): LearningSummary {
    const ranges = Object.values(this.knowledge.priceRanges);
    const total = ranges.reduce((s, pr) => s + toNum(pr.count, 0), 0);
    const avgPrice = total
      ? ranges.reduce((s, pr) => s + toNum(pr.avg, 0) * toNum(pr.count, 0), 0) / total
      : 0;
    return {
      totalListings: total,
      districts: Object.keys(this.knowledge.priceRanges).length,
      overallAvg: Math.round(avgPrice),
      qualityScore: Math.round(this.knowledge.qualityScore * 100),
      patterns: this.knowledge.totalPatterns || Object.keys(this.knowledge.patterns).length,
      parseRules: this.knowledge.parseRules.length,
    };
  }

  exportMemory(): string {
    return JSON.stringify(this.knowledge, null, 2);
  }

  importMemory(jsonData: string): { success: boolean; message: string } {
    const parsed = safeJSONParse<Partial<LearningKnowledge> | null>(jsonData, null);
    if (!parsed) return { success: false, message: 'Invalid JSON format' };
    if (Array.isArray(parsed)) return { success: false, message: 'Expected AI memory object, not array' };
    try {
      if (parsed.patterns && typeof parsed.patterns === 'object')
        this.knowledge.patterns = parsed.patterns;
      if (Array.isArray(parsed.correlations))
        this.knowledge.correlations = parsed.correlations;
      if (Array.isArray(parsed.marketTrends))
        this.knowledge.marketTrends = parsed.marketTrends;
      if (parsed.priceRanges && typeof parsed.priceRanges === 'object')
        this.knowledge.priceRanges = parsed.priceRanges;
      if (Array.isArray(parsed.parseRules))
        this.knowledge.parseRules = parsed.parseRules;
      this.knowledge.qualityScore = toNum(parsed.qualityScore, 0);
      this.knowledge.processedCount = toNum(parsed.processedCount, 0);
      this.save();
      return { success: true, message: `Imported from ${parsed.version || 'unknown'} → v4.0` };
    } catch (e) {
      return { success: false, message: `Import error: ${(e as Error)?.message}` };
    }
  }
}

export const learner = new LearningEngine();

export function computeQualityScore(listing: Listing): number {
  if (!listing) return 0;
  let score = 1.0;
  const price = toNum(listing.priceUGX, 0);
  if (price > 50) score += 0.3;
  if (price > 100) score += 0.2;
  if (price > 200) score += 0.2;
  if (listing.size && !listing.size.includes('unknown')) score += 0.3;
  if (listing.suburb && listing.suburb.length > 3) score += 0.2;
  if (listing.agent) score += 0.1;
  if (listing.contact) score += 0.1;
  if (listing.village) score += 0.2;
  if (listing._geocoded) score += 0.3;
  if (listing._geocodeSource === 'local') score += 0.15;
  return Math.min(score, 2.0);
}
