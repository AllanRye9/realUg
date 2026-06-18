import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Listing, UnverifiedLocation } from '@/types';
import { localGeocode, DISTRICT_CENTRES, ALL_DISTRICTS } from '@/lib/ugandaData';

interface MapViewProps {
  listings: Listing[];
  unverifiedLocations?: UnverifiedLocation[];
  onSelect: (listing: Listing) => void;
}

const TILE_LAYERS: Record<string, { url: string; opts: L.TileLayerOptions }> = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    opts: { maxZoom: 20, attribution: '&copy; CartoDB' },
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { maxZoom: 20, attribution: '&copy; CartoDB' },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 19, attribution: '&copy; Esri' },
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 19, attribution: '&copy; OpenStreetMap' },
  },
};

function createMarkerSvg(color: string): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
      </filter>
    </defs>
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21c0-7.2-5.8-13-13-13z" fill="${color}" stroke="#fff" stroke-width="2" filter="url(#shadow)"/>
    <circle cx="13" cy="13" r="5" fill="#fff"/>
  </svg>`;
}

function getMarkerColor(listing: Listing): string {
  if (listing.status === 'sold') return '#f85149';
  if (listing.interest === 'high') return '#16a34a';
  if (listing.interest === 'medium') return '#eab308';
  return '#3b82f6';
}

// Only show markers for geocoded (verified) or local-geocoded listings
// Fallback-only listings with no meaningful location should be filtered
function isPlottable(listing: Listing): boolean {
  if (!listing || !isFinite(listing.lat) || !isFinite(listing.lng)) return false;
  if (listing.lat === 0 && listing.lng === 0) return false;
  // Accept OSM-verified or local-database matches
  if (listing._geocoded) return true;
  if (listing._geocodeSource === 'local') return true;
  // Accept fallback only if a village is present (district centre used intentionally)
  if (listing._geocodeSource === 'fallback' && listing.village) return true;
  // If no geocode source field but coords look real (not exact district centre), allow
  const centre = DISTRICT_CENTRES[listing.areaName] || DISTRICT_CENTRES['Gulu'];
  const atCentre =
    Math.abs(listing.lat - centre.lat) < 0.0001 &&
    Math.abs(listing.lng - centre.lng) < 0.0001;
  if (atCentre && !listing.village) return false;
  return true;
}

export default function MapView({ listings, unverifiedLocations = [], onSelect }: MapViewProps) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const unverifiedMarkersRef = useRef<L.CircleMarker[]>([]);
  const [tileStyle, setTileStyle] = useState('dark');
  const [search, setSearch] = useState('');
  const [searchMsg, setSearchMsg] = useState('');
  const [searchError, setSearchError] = useState(false);
  const [showUnverified, setShowUnverified] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;

    const map = L.map(mapDiv.current, {
      preferCanvas: true,
      zoomControl: true,
    }).setView([2.7725, 32.299], 8);

    const def = TILE_LAYERS[tileStyle];
    tileRef.current = L.tileLayer(def.url, def.opts).addTo(map);

    // Add scale control
    L.control.scale({ imperial: false }).addTo(map);

    mapRef.current = map;
    setMapReady(true);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      setMapReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update tile layer
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    if (tileRef.current) {
      mapRef.current.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const def = TILE_LAYERS[tileStyle];
    tileRef.current = L.tileLayer(def.url, def.opts).addTo(mapRef.current);
  }, [tileStyle, mapReady]);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    // Clear existing markers
    markersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    markersRef.current = [];
    unverifiedMarkersRef.current.forEach(m => { try { m.remove(); } catch { /* ignore */ } });
    unverifiedMarkersRef.current = [];

    // Only plot listings with real coordinates
    const plottableListings = (listings || []).filter(isPlottable);

    plottableListings.forEach(l => {
      if (!mapRef.current) return;
      const color = getMarkerColor(l);
      const svg = createMarkerSvg(color);
      const icon = L.divIcon({
        html: svg,
        iconSize: [26, 34],
        iconAnchor: [13, 34],
        popupAnchor: [0, -34],
        className: '',
      });

      const opacity = (l._geocoded || l._geocodeSource === 'local') ? 1 : 0.65;

      try {
        const marker = L.marker([l.lat, l.lng], { icon, opacity }).addTo(mapRef.current!);

        const postsBadge =
          (l.posts || 1) > 1
            ? ` <span style="background:#f59e0b;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">+${l.posts}</span>`
            : '';
        const sourceBadge = l._geocoded
          ? ' <span style="background:#16a34a;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">OSM verified</span>'
          : l._geocodeSource === 'local'
          ? ' <span style="background:#2563eb;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">local db</span>'
          : ' <span style="background:#64748b;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">estimated</span>';

        const popupContent = `
          <div style="font-family:system-ui,sans-serif;min-width:180px">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">${l.title || 'Property'}${postsBadge}${sourceBadge}</div>
            <div style="font-size:12px;color:#166534;font-weight:600">UGX ${l.priceUGX || 0}M</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${l.size || ''}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px">${l.areaName || ''}${l.village ? ` &middot; ${l.village}` : ''}${l.suburb ? ` &middot; ${l.suburb}` : ''}</div>
            ${l.agent ? `<div style="font-size:11px;color:#2563eb;margin-top:2px">Agent: ${l.agent}</div>` : ''}
            ${l.contact ? `<div style="font-size:11px;color:#2563eb">Contact: ${l.contact}</div>` : ''}
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</div>
          </div>
        `;

        marker.bindPopup(popupContent);
        marker.on('click', () => onSelect(l));
        markersRef.current.push(marker);
      } catch (err) {
        console.warn('Failed to create marker for listing', l.id, err);
      }
    });

    // Add unverified location markers (dashed circles at district centres)
    if (showUnverified && unverifiedLocations.length > 0) {
      // Use a stable random offset per ID to prevent jitter on re-render
      unverifiedLocations.forEach(uv => {
        if (!mapRef.current) return;
        const district = uv.listing?.district || 'Gulu';
        const centre = DISTRICT_CENTRES[district as string] || DISTRICT_CENTRES['Gulu'];
        // Deterministic offset based on id
        const seed = (uv.id || 0) % 1000;
        const latOffset = ((seed * 7919) % 200 - 100) / 5000;
        const lngOffset = ((seed * 6271) % 200 - 100) / 5000;

        try {
          const circle = L.circleMarker([centre.lat + latOffset, centre.lng + lngOffset], {
            radius: 8,
            color: '#dc2626',
            fillColor: '#fca5a5',
            fillOpacity: 0.5,
            weight: 2,
            dashArray: '4, 4',
          }).addTo(mapRef.current!);

          circle.bindPopup(`
            <div style="font-family:system-ui,sans-serif">
              <div style="font-weight:600;font-size:12px;color:#dc2626">⚠ Unverified Location</div>
              <div style="font-size:11px;margin-top:2px">"${uv.extractedLocation}"</div>
              <div style="font-size:10px;color:#64748b;margin-top:2px">${uv.reason}</div>
              ${uv.attemptedQueries?.length ? `<div style="font-size:10px;color:#92400e;margin-top:4px">Tried: ${uv.attemptedQueries.join(', ')}</div>` : ''}
            </div>
          `);

          unverifiedMarkersRef.current.push(circle);
        } catch (err) {
          console.warn('Failed to create unverified marker', uv.id, err);
        }
      });
    }

    // Fit bounds to visible content
    const allMarkers = [...markersRef.current, ...unverifiedMarkersRef.current];
    if (allMarkers.length > 0 && mapRef.current) {
      try {
        const group = new L.FeatureGroup(allMarkers);
        const bounds = group.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds.pad(0.15), { maxZoom: 14 });
        }
      } catch {
        mapRef.current?.setView([2.7725, 32.299], 8);
      }
    } else if (mapRef.current) {
      mapRef.current.setView([2.7725, 32.299], 8);
    }
  }, [listings, unverifiedLocations, showUnverified, onSelect, mapReady]);

  // Map search handler
  const handleSearch = useCallback(async () => {
    const q = search.trim();
    if (!q) {
      setSearchMsg('Enter a place name');
      setSearchError(false);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => setSearchMsg(''), 3000);
      return;
    }
    if (!mapRef.current) return;

    setSearchMsg('Searching...');
    setSearchError(false);

    // 1. Try local database
    const local = localGeocode(q);
    if (local) {
      mapRef.current.flyTo([local.lat, local.lng], 14, { animate: true, duration: 1 });
      setSearchMsg(`📍 ${q}`);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => setSearchMsg(''), 4000);
      return;
    }

    // 2. Try district name match
    const distMatch = ALL_DISTRICTS.find(d =>
      q.toLowerCase().includes(d.toLowerCase()) ||
      d.toLowerCase().includes(q.toLowerCase())
    );
    if (distMatch) {
      const c = DISTRICT_CENTRES[distMatch];
      mapRef.current.flyTo([c.lat, c.lng], 12, { animate: true, duration: 1 });
      setSearchMsg(`📍 ${distMatch} district`);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => setSearchMsg(''), 4000);
      return;
    }

    // 3. Try OSM Nominatim with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Uganda')}&format=json&limit=3&countrycodes=ug&accept-language=en`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UgandaRealEstateMap/1.0' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const best = data[0];
          const lat = parseFloat(best.lat);
          const lng = parseFloat(best.lon);
          if (isFinite(lat) && isFinite(lng) && mapRef.current) {
            mapRef.current.flyTo([lat, lng], 14, { animate: true, duration: 1 });
            const label = best.display_name?.split(',')[0] || q;
            setSearchMsg(`📍 ${label}`);
            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = setTimeout(() => setSearchMsg(''), 4000);
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setSearchMsg('Search timed out — try again');
        setSearchError(true);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => { setSearchMsg(''); setSearchError(false); }, 4000);
        return;
      }
      // Network error — fall through to not-found
    }

    setSearchMsg(`"${q}" not found in Uganda`);
    setSearchError(true);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => { setSearchMsg(''); setSearchError(false); }, 4000);
  }, [search]);

  const verifiedCount = (listings || []).filter(l => l._geocoded).length;
  const localCount = (listings || []).filter(l => !l._geocoded && l._geocodeSource === 'local').length;
  const estimatedCount = (listings || []).filter(l => isPlottable(l) && !l._geocoded && l._geocodeSource !== 'local').length;
  const unplottableCount = (listings || []).filter(l => !isPlottable(l)).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Map Container */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200" style={{ height: '500px' }}>
        <div ref={mapDiv} className="w-full h-full" />

        {/* Search Controls */}
        <div className="absolute top-3 right-3 z-[1000] bg-black/75 backdrop-blur-sm p-2 rounded-lg flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search Uganda places..."
            className="px-3 py-1.5 w-48 bg-[#1e1e2f] text-white border border-gray-600 rounded text-xs outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSearch}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors"
          >
            Go
          </button>
        </div>

        {/* Search Message */}
        {searchMsg && (
          <div className={`absolute bottom-14 right-3 z-[1000] px-4 py-2 rounded-full text-xs ${
            searchError ? 'bg-red-900/80 text-red-200' : 'bg-black/80 text-white'
          }`}>
            {searchMsg}
          </div>
        )}

        {/* Map Style Selector */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg p-1.5 flex gap-1">
          {Object.keys(TILE_LAYERS).map(s => (
            <button
              key={s}
              onClick={() => setTileStyle(s)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium capitalize transition-colors ${
                tileStyle === s
                  ? 'bg-blue-500 text-white'
                  : 'bg-[#2d2d2d] text-gray-300 hover:bg-[#3d3d3d]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 right-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg p-2 text-[10px] text-white">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> High Interest
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" /> Medium
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Low
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Sold
          </div>
        </div>
      </div>

      {/* Unverified Locations Section */}
      {unverifiedLocations.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div
            className="flex items-center justify-between px-4 py-3 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors"
            onClick={() => setShowUnverified(!showUnverified)}
          >
            <div className="flex items-center gap-2">
              <span className="text-amber-600 font-semibold text-sm">
                ⚠ Unverified Locations ({unverifiedLocations.length})
              </span>
              <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                not found on OSM
              </span>
            </div>
            <button className="text-amber-600 text-xs font-medium hover:text-amber-800">
              {showUnverified ? 'Hide' : 'Show'} on Map
            </button>
          </div>

          {showUnverified && (
            <div className="p-4">
              <p className="text-xs text-slate-500 mb-3">
                These locations were extracted from listings but could not be verified through OpenStreetMap.
                They appear as dashed red circles at approximate district centre positions.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {unverifiedLocations.map(uv => (
                  <div
                    key={uv.id}
                    className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100"
                  >
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-red-500 text-xs font-bold">?</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-800 truncate">
                        {uv.extractedLocation || 'Unknown location'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 break-words">
                        From: &quot;{(uv.originalText || '').slice(0, 60)}{uv.originalText?.length > 60 ? '…' : ''}&quot;
                      </div>
                      <div className="text-[10px] text-red-500 mt-1">
                        {uv.reason}
                      </div>
                      {uv.attemptedQueries?.length ? (
                        <div className="text-[10px] text-slate-400 mt-1">
                          Searched: {uv.attemptedQueries.join('; ')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats Bar */}
      <div className="flex gap-3 flex-wrap">
        {verifiedCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {verifiedCount} OSM verified
          </div>
        )}
        {localCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {localCount} local database
          </div>
        )}
        {estimatedCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-slate-400" />
            {estimatedCount} estimated
          </div>
        )}
        {unverifiedLocations.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            {unverifiedLocations.length} unverified locations
          </div>
        )}
        {unplottableCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-slate-300" />
            {unplottableCount} no coordinates
          </div>
        )}
      </div>
    </div>
  );
}
