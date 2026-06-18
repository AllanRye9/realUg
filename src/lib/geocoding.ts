import { localGeocode, DISTRICT_CENTRES } from './ugandaData';
import type { GeocodeResult, UnverifiedLocation } from '@/types';

// In-memory cache: null means "tried and not found", undefined means "not tried"
const geoCache = new Map<string, GeocodeResult | null>();

/**
 * Geocode a location using OSM Nominatim API.
 * Returns null if the place cannot be found (unverified).
 *
 * Fixes:
 * - AbortController timeout prevents hanging requests
 * - Validates lat/lng are finite numbers before accepting result
 * - Bounds-check: rejects OSM results outside Uganda (roughly)
 * - Network errors don't pollute the cache (transient vs permanent miss)
 */
export async function geocodeOSM(
  village: string,
  district: string
): Promise<GeocodeResult | null> {
  if (!village || !village.trim()) return null;

  const v = village.trim();
  const cacheKey = `${v.toLowerCase()}|${district.toLowerCase()}`;

  if (geoCache.has(cacheKey)) {
    return geoCache.get(cacheKey) ?? null;
  }

  // Try local database first (instant, no network)
  const local = localGeocode(v + ' ' + district);
  if (local) {
    const result: GeocodeResult = { lat: local.lat, lng: local.lng, source: 'local' };
    geoCache.set(cacheKey, result);
    return result;
  }

  // Also try just the village name alone against local db
  const localV = localGeocode(v);
  if (localV) {
    const result: GeocodeResult = { lat: localV.lat, lng: localV.lng, source: 'local' };
    geoCache.set(cacheKey, result);
    return result;
  }

  // OSM Nominatim with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const query = `${v}, ${district}, Uganda`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&countrycodes=ug&accept-language=en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UgandaRealEstateMap/1.0 (educational project)' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Pick first result with valid Uganda-bounds coordinates
        for (const place of data) {
          const lat = parseFloat(place.lat);
          const lng = parseFloat(place.lon);
          if (
            isFinite(lat) && isFinite(lng) &&
            lat >= -2 && lat <= 5 &&    // Uganda lat range
            lng >= 29.5 && lng <= 35.1  // Uganda lng range
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
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error)?.name === 'AbortError') {
      // Timeout — do NOT cache, allow retry later
      console.warn(`[geocoding] Timeout for "${v}, ${district}"`);
      return null;
    }
    // Network error — do NOT cache, could be transient
    console.warn(`[geocoding] Network error for "${v}, ${district}":`, (err as Error)?.message);
    return null;
  }

  // Genuine not found — cache the miss
  geoCache.set(cacheKey, null);
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

  // Attempt 3: first word only (sometimes the key place token)
  const firstWord = v.split(/\s+/)[0];
  if (firstWord && firstWord.length > 3 && firstWord !== cleaned && firstWord !== v) {
    result = await geocodeOSM(firstWord, district);
    attemptedQueries.push(`${firstWord}, ${district}, Uganda`);
    if (result) return { result, attemptedQueries };
  }

  // Attempt 4: village without district (sometimes OSM finds it globally)
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
 * Returns verified listings with coords and a list of unverified locations.
 * Processes in batches of 3 to respect Nominatim rate limits (1 req/sec).
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

  const batchSize = 3;
  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(l => geocodeListing(l)));

    for (let j = 0; j < results.length; j++) {
      const settled = results[j];
      const listing = batch[j];
      if (settled.status === 'fulfilled') {
        const result = settled.value;
        if (result.isVerified && result.coords) {
          verified.push({ id: listing.id, coords: result.coords });
        } else if (result.unverified) {
          unverified.push(result.unverified);
        }
      } else {
        // Rejected promise — treat as unverified
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

    // 350ms between batches to stay under Nominatim 1 req/sec limit
    if (i + batchSize < listings.length) {
      await new Promise(r => setTimeout(r, 350));
    }
  }

  return { verified, unverified };
}

/** Clear the in-memory geocoding cache (useful for testing or manual refresh). */
export function clearGeoCache(): void {
  geoCache.clear();
}
