import { localGeocode, DISTRICT_CENTRES } from './ugandaData';
import type { GeocodeResult, UnverifiedLocation } from '@/types';

// ---------- LRU cache (simple, size-limited) ----------
class LRUCache<K, V> {
  private map = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number = 1000) { // give a default to be safe
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // Evict oldest (first inserted)
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey!); // ← fix: non-null assertion
    }
    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}

// ---------- Rate limiter (1 request/second for OSM) ----------
class RateLimiter {
  private lastRequestTime = 0;
  private minIntervalMs: number;

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      const delay = this.minIntervalMs - elapsed;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    this.lastRequestTime = Date.now(); // update after the wait
  }
}

// ---------- Global state ----------
// Cache: null = "proven not found", undefined = not tried
// Using LRU with a cap of 5000 entries – adjust as needed
const MAX_CACHE_SIZE = 5000;
const geoCache = new LRUCache<string, GeocodeResult | null>(MAX_CACHE_SIZE);

// Rate limiter: 1 request per second to Nominatim
const nominatimLimiter = new RateLimiter(1);

// ---------- Helper: check if an error is transient (should not be cached) ----------
function isTransientError(status: number): boolean {
  return status === 429 || status >= 500; // rate-limit or server errors
}

// ---------- Core geocoding functions ----------

/**
 * Geocode a location using OSM Nominatim API.
 * Returns null if the place cannot be found (unverified).
 *
 * Robustness:
 * - Enforces 1 req/sec rate limit globally via RateLimiter
 * - Does NOT cache transient failures (429, 5xx)
 * - Retries once on network/transient errors with a short delay
 */
export async function geocodeOSM(
  village: string,
  district: string
): Promise<GeocodeResult | null> {
  if (!village || !village.trim()) return null;

  const v = village.trim();
  const cacheKey = `${v.toLowerCase()}|${district.toLowerCase()}`;

  // Check LRU cache
  const cached = geoCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ?? null;
  }

  // ---- Local database (instant, no rate limit) ----
  const local = localGeocode(v + ' ' + district);
  if (local) {
    const result: GeocodeResult = { lat: local.lat, lng: local.lng, source: 'local' };
    geoCache.set(cacheKey, result);
    return result;
  }

  const localV = localGeocode(v);
  if (localV) {
    const result: GeocodeResult = { lat: localV.lat, lng: localV.lng, source: 'local' };
    geoCache.set(cacheKey, result);
    return result;
  }

  // ---- OSM Nominatim with retry & rate limiting ----
  const maxRetries = 1;
  const query = `${v}, ${district}, Uganda`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&countrycodes=ug&accept-language=en`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Wait for rate-limit slot before each HTTP request
    await nominatimLimiter.waitForSlot();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UgandaRealEstateMap/1.0 (educational project)' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          for (const place of data) {
            const lat = parseFloat(place.lat);
            const lng = parseFloat(place.lon);
            if (
              isFinite(lat) && isFinite(lng) &&
              lat >= -2 && lat <= 5 &&
              lng >= 29.5 && lng <= 35.1
            ) {
              const result: GeocodeResult = {
                lat,
                lng,
                source: 'osm',
                displayName: place.display_name,
              };
              geoCache.set(cacheKey, result);
              return result;
            }
          }
        }
        // Nominatim returned 200 but no results – cache as genuine miss
        geoCache.set(cacheKey, null);
        return null;
      }

      // Non-ok response (e.g. 429, 503)
      if (isTransientError(res.status)) {
        console.warn(
          `[geocoding] Transient error ${res.status} for "${v}, ${district}" (attempt ${attempt + 1})`
        );
        if (attempt < maxRetries) {
          // Wait a bit longer before retry
          await new Promise(r => setTimeout(r, 2000));
          continue; // retry
        }
        // Exhausted retries – do NOT cache
        return null;
      }

      // Other client errors (4xx except 429) – treat as permanent miss
      console.warn(`[geocoding] Permanent error ${res.status} for "${v}, ${district}"`);
      geoCache.set(cacheKey, null);
      return null;

    } catch (err) {
      clearTimeout(timeoutId);
      const error = err as Error;
      if (error.name === 'AbortError') {
        // Timeout – transient, do not cache
        console.warn(`[geocoding] Timeout for "${v}, ${district}"`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      // Network error – transient, do not cache
      console.warn(`[geocoding] Network error for "${v}, ${district}":`, error.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      return null;
    }
  }

  // Should not reach here, but for safety
  return null;
}

/**
 * Try multiple geocoding queries with variations.
 * Each variation is attempted in sequence; first success wins.
 */
export async function geocodeWithVariations(
  village: string,
  district: string
): Promise<{
  result: GeocodeResult | null;
  attemptedQueries: string[];
}> {
  const attemptedQueries: string[] = [];

  if (!village || !village.trim()) {
    return { result: null, attemptedQueries };
  }

  const v = village.trim();

  // Attempt 1: exact village + district
  let result = await geocodeOSM(v, district);
  attemptedQueries.push(`${v}, ${district}, Uganda`);
  if (result) return { result, attemptedQueries };

  // Attempt 2: strip trailing suffix words
  const cleaned = v
    .replace(/\s+(district|sub[\s-]?county|village|town|city|parish|ward|division|area|estate|zone|block)$/i, '')
    .trim();
  if (cleaned && cleaned !== v && cleaned.length > 2) {
    result = await geocodeOSM(cleaned, district);
    attemptedQueries.push(`${cleaned}, ${district}, Uganda`);
    if (result) return { result, attemptedQueries };
  }

  // Attempt 3: first word only
  const firstWord = v.split(/\s+/)[0];
  if (firstWord && firstWord.length > 3 && firstWord !== cleaned && firstWord !== v) {
    result = await geocodeOSM(firstWord, district);
    attemptedQueries.push(`${firstWord}, ${district}, Uganda`);
    if (result) return { result, attemptedQueries };
  }

  // Attempt 4: village without district
  if (v.length > 4) {
    result = await geocodeOSM(v, '');
    attemptedQueries.push(`${v}, Uganda`);
    if (result) return { result, attemptedQueries };
  }

  return { result: null, attemptedQueries };
}

/**
 * Geocode a listing and classify as verified or unverified.
 */
export async function geocodeListing(listingData: {
  village: string;
  district: string;
  id?: number;
  originalText?: string;
}): Promise<{
  coords: GeocodeResult | null;
  isVerified: boolean;
  unverified?: UnverifiedLocation;
}> {
  const { village, district, id, originalText } = listingData;

  if (!village || !village.trim()) {
    return { coords: null, isVerified: false };
  }

  const { result, attemptedQueries } = await geocodeWithVariations(village, district);

  if (result) {
    return { coords: result, isVerified: true };
  }

  const unverified: UnverifiedLocation = {
    id: id ?? Date.now() + Math.random(),
    originalText: originalText || village,
    extractedLocation: village,
    reason: `"${village}" not found in OSM for ${district} district`,
    listing: { village, district },
    attemptedQueries,
  };

  return { coords: null, isVerified: false, unverified };
}

/**
 * Get district centre as fallback coordinates.
 */
export function getFallbackCoords(district: string): GeocodeResult {
  const centre = DISTRICT_CENTRES[district] || DISTRICT_CENTRES['Gulu'];
  return { lat: centre.lat, lng: centre.lng, source: 'fallback' };
}

/**
 * Batch geocode multiple listings.
 * Processes one by one to ensure rate‑limit compliance
 * (1 request/sec, with retries already handled inside geocodeOSM).
 */
export async function batchGeocode(
  listings: Array<{
    village: string;
    district: string;
    id: number;
    originalText: string;
  }>
): Promise<{
  verified: Array<{ id: number; coords: GeocodeResult }>;
  unverified: UnverifiedLocation[];
}> {
  const verified: Array<{ id: number; coords: GeocodeResult }> = [];
  const unverified: UnverifiedLocation[] = [];

  // Process sequentially – rate limiting is enforced by geocodeOSM's internal limiter.
  // Sequential processing also simplifies error handling and avoids parallel overload.
  for (const listing of listings) {
    try {
      const result = await geocodeListing(listing);
      if (result.isVerified && result.coords) {
        verified.push({ id: listing.id, coords: result.coords });
      } else if (result.unverified) {
        unverified.push(result.unverified);
      }
    } catch {
      // Unexpected error – treat as unverified
      unverified.push({
        id: listing.id,
        originalText: listing.originalText,
        extractedLocation: listing.village,
        reason: 'Geocoding failed with an unexpected error',
        listing: { village: listing.village, district: listing.district },
        attemptedQueries: [],
      });
    }
  }

  return { verified, unverified };
}

/** Clear the LRU geocoding cache (useful for testing or manual refresh). */
export function clearGeoCache(): void {
  geoCache.clear();
}