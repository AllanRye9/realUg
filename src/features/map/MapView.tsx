/**
 * features/map/MapView.tsx
 * Leaflet map — OSM divider line, verified above / unverified below,
 * improved legend, deterministic circle jitter, tile switcher.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Listing, UnverifiedLocation } from '@/types';
import { localGeocode, DISTRICT_CENTRES, ALL_DISTRICTS } from '@/lib/ugandaData';

interface Props {
  listings: Listing[];
  unverifiedLocations?: UnverifiedLocation[];
  onSelect: (l: Listing) => void;
}

const TILES: Record<string, { url: string; opts: L.TileLayerOptions }> = {
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',      opts: { maxZoom: 20, attribution: '© CartoDB' } },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',     opts: { maxZoom: 20, attribution: '© CartoDB' } },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, attribution: '© Esri' } },
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                 opts: { maxZoom: 19, attribution: '© OSM' } },
};

function pin(color: string, opacity = 1) {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="sh"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/></filter></defs>
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 21 13 21s13-11.3 13-21C26 5.8 20.2 0 13 0z"
          fill="${color}" stroke="#fff" stroke-width="2" filter="url(#sh)" opacity="${opacity}"/>
    <circle cx="13" cy="13" r="5" fill="#fff"/>
  </svg>`;
}

function color(l: Listing) {
  if (l.status === 'sold')     return '#f85149';
  if (l.interest === 'high')   return '#16a34a';
  if (l.interest === 'medium') return '#eab308';
  return '#3b82f6';
}

function plottable(l: Listing) {
  if (!l || !isFinite(l.lat) || !isFinite(l.lng)) return false;
  if (l.lat === 0 && l.lng === 0) return false;
  if (l._geocoded || l._geocodeSource === 'local') return true;
  if (l._geocodeSource === 'fallback' && l.village) return true;
  const c = DISTRICT_CENTRES[l.areaName] || DISTRICT_CENTRES['Gulu'];
  return !(Math.abs(l.lat - c.lat) < 0.0001 && Math.abs(l.lng - c.lng) < 0.0001 && !l.village);
}

function jitter(seed: number) { return ((seed % 200) - 100) / 5000; }

export default function MapView({ listings, unverifiedLocations = [], onSelect }: Props) {
  const divRef    = useRef<HTMLDivElement>(null);
  const mapRef    = useRef<L.Map | null>(null);
  const tileRef   = useRef<L.TileLayer | null>(null);
  const mkRef     = useRef<L.Marker[]>([]);
  const circRef   = useRef<L.CircleMarker[]>([]);
  const lineRef   = useRef<L.Polyline | null>(null);
  const toRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [style,      setStyle]      = useState('dark');
  const [search,     setSearch]     = useState('');
  const [smsg,       setSmsg]       = useState('');
  const [serr,       setSerr]       = useState(false);
  const [showUnv,    setShowUnv]    = useState(true);
  const [ready,      setReady]      = useState(false);

  // ── init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { preferCanvas: true }).setView([2.7725, 32.299], 8);
    tileRef.current = L.tileLayer(TILES[style].url, TILES[style].opts).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    mapRef.current = map;
    setReady(true);
    return () => {
      if (toRef.current) clearTimeout(toRef.current);
      try { lineRef.current?.remove(); } catch { /**/ }
      map.remove(); mapRef.current = null; tileRef.current = null; setReady(false);
    };
  }, []); // eslint-disable-line

  // ── tile swap ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    if (tileRef.current) mapRef.current.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(TILES[style].url, TILES[style].opts).addTo(mapRef.current);
  }, [style, ready]);

  // ── markers + divider ────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const map = mapRef.current;

    mkRef.current.forEach(m   => { try { m.remove(); } catch { /**/ } });
    circRef.current.forEach(c => { try { c.remove(); } catch { /**/ } });
    try { lineRef.current?.remove(); } catch { /**/ }
    mkRef.current = []; circRef.current = []; lineRef.current = null;

    // verified pins
    (listings || []).filter(plottable).forEach(l => {
      const op = (l._geocoded || l._geocodeSource === 'local') ? 1 : 0.65;
      const icon = L.divIcon({ html: pin(color(l), op), iconSize: [26,34], iconAnchor: [13,34], popupAnchor: [0,-34], className: '' });
      try {
        const src = l._geocoded
          ? '<span style="background:#16a34a;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px">OSM</span>'
          : l._geocodeSource === 'local'
          ? '<span style="background:#2563eb;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px">local</span>'
          : '<span style="background:#64748b;color:#fff;padding:1px 5px;border-radius:4px;font-size:9px">est.</span>';
        const m = L.marker([l.lat, l.lng], { icon, opacity: op }).addTo(map);
        m.bindPopup(`<div style="font-family:system-ui;min-width:180px">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">${l.title || 'Property'} ${src}</div>
          <div style="font-size:12px;color:#166534;font-weight:600">UGX ${l.priceUGX || 0}M</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${l.size || ''}</div>
          <div style="font-size:11px;color:#475569;margin-top:2px">${l.areaName || ''}${l.village ? ' · ' + l.village : ''}</div>
          ${l.agent   ? `<div style="font-size:11px;color:#2563eb;margin-top:2px">Agent: ${l.agent}</div>` : ''}
          ${l.contact ? `<div style="font-size:11px;color:#2563eb">Contact: ${l.contact}</div>` : ''}
          <div style="font-size:10px;color:#94a3b8;margin-top:4px">${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}</div>
        </div>`);
        m.on('click', () => onSelect(l));
        mkRef.current.push(m);
      } catch (e) { console.warn('marker', l.id, e); }
    });

    // unverified circles
    if (showUnv) {
      unverifiedLocations.forEach(uv => {
        const d = String(uv.listing?.district || 'Gulu');
        const c = DISTRICT_CENTRES[d] || DISTRICT_CENTRES['Gulu'];
        const seed = (uv.id || 0) % 1000;
        try {
          const circ = L.circleMarker(
            [c.lat + jitter(seed * 7919), c.lng + jitter(seed * 6271)],
            { radius: 8, color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 0.5, weight: 2, dashArray: '4,4' }
          ).addTo(map);
          circ.bindPopup(`<div style="font-family:system-ui">
            <div style="font-weight:600;font-size:12px;color:#dc2626">⚠ Not on OSM</div>
            <div style="font-size:11px;margin-top:2px">"${uv.extractedLocation}"</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">${uv.reason}</div>
            ${uv.attemptedQueries?.length ? `<div style="font-size:10px;color:#92400e;margin-top:4px">Tried: ${uv.attemptedQueries.join('; ')}</div>` : ''}
          </div>`);
          circRef.current.push(circ);
        } catch (e) { console.warn('circle', uv.id, e); }
      });
    }

    // OSM divider polyline between verified above and unverified below
    const vLLs = mkRef.current.map(m => m.getLatLng());
    const uLLs = circRef.current.map(c => c.getLatLng());
    if (vLLs.length > 0 && uLLs.length > 0) {
      try {
        const allLats = [...vLLs, ...uLLs].map(ll => ll.lat).sort((a, b) => a - b);
        const mid     = allLats[Math.floor(allLats.length / 2)];
        const b       = map.getBounds();
        lineRef.current = L.polyline(
          [[mid, b.getWest() - 5], [mid, b.getEast() + 5]],
          { color: 'rgba(255,255,255,0.4)', weight: 1.5, dashArray: '8,6', interactive: false }
        ).addTo(map);
        lineRef.current.bindTooltip(
          '<div style="font-size:10px;padding:1px 6px">↑ OSM verified · unverified ↓</div>',
          { sticky: true, direction: 'top' }
        );
      } catch { /**/ }
    }

    // fit bounds
    const all = [...mkRef.current, ...circRef.current];
    if (all.length > 0) {
      try {
        const b = new L.FeatureGroup(all).getBounds();
        if (b.isValid()) map.fitBounds(b.pad(0.15), { maxZoom: 14 });
      } catch { map.setView([2.7725, 32.299], 8); }
    } else {
      map.setView([2.7725, 32.299], 8);
    }
  }, [listings, unverifiedLocations, showUnv, onSelect, ready]);

  // ── search ───────────────────────────────────────────────────────────
  const flash = (msg: string, err = false) => {
    setSmsg(msg); setSerr(err);
    if (toRef.current) clearTimeout(toRef.current);
    toRef.current = setTimeout(() => { setSmsg(''); setSerr(false); }, 4000);
  };

  const doSearch = useCallback(async () => {
    const q = search.trim();
    if (!q || !mapRef.current) return;
    flash('Searching…');
    // 1. local DB
    const lc = localGeocode(q);
    if (lc) { mapRef.current.flyTo([lc.lat, lc.lng], 14, { animate: true, duration: 1 }); flash(`📍 ${q}`); return; }
    // 2. district
    const dm = ALL_DISTRICTS.find(d => q.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(q.toLowerCase()));
    if (dm) { const c = DISTRICT_CENTRES[dm]; mapRef.current.flyTo([c.lat, c.lng], 12, { animate: true, duration: 1 }); flash(`📍 ${dm}`); return; }
    // 3. OSM
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 6000);
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Uganda')}&format=json&limit=3&countrycodes=ug`,
        { headers: { 'User-Agent': 'UgandaRealEstateMap/2.0' }, signal: ctrl.signal }
      );
      clearTimeout(tid);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
          if (isFinite(lat) && isFinite(lng) && mapRef.current) {
            mapRef.current.flyTo([lat, lng], 14, { animate: true, duration: 1 });
            flash(`📍 ${data[0].display_name?.split(',')[0] || q}`); return;
          }
        }
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') { flash('Search timed out', true); return; }
    }
    flash(`"${q}" not found in Uganda`, true);
  }, [search]);

  const osmC = (listings || []).filter(l => l._geocoded).length;
  const locC = (listings || []).filter(l => !l._geocoded && l._geocodeSource === 'local').length;
  const estC = (listings || []).filter(l => plottable(l) && !l._geocoded && l._geocodeSource !== 'local').length;

  return (
    <div className="flex flex-col gap-3">
      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200" style={{ height: 500 }}>
        <div ref={divRef} className="w-full h-full" />

        {/* Search */}
        <div className="absolute top-3 right-3 z-[1000] bg-black/75 backdrop-blur-sm p-2 rounded-lg flex gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Search Uganda places…"
            className="px-3 py-1.5 w-48 bg-[#1e1e2f] text-white border border-gray-600 rounded text-xs outline-none focus:border-blue-500" />
          <button onClick={doSearch} className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors">Go</button>
        </div>

        {smsg && (
          <div className={`absolute bottom-14 right-3 z-[1000] px-4 py-2 rounded-full text-xs ${serr ? 'bg-red-900/80 text-red-200' : 'bg-black/80 text-white'}`}>
            {smsg}
          </div>
        )}

        {/* Tile switcher */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg p-1.5 flex gap-1">
          {Object.keys(TILES).map(s => (
            <button key={s} onClick={() => setStyle(s)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium capitalize transition-colors ${style === s ? 'bg-blue-500 text-white' : 'bg-[#2d2d2d] text-gray-300 hover:bg-[#3d3d3d]'}`}>
              {s}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 right-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg p-2.5 text-[10px] text-white">
          <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">OSM verified</div>
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> High interest</div>
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" /> Medium</div>
          <div className="flex items-center gap-1.5 mb-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Low</div>
          <div className="flex items-center gap-1.5 mb-2"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Sold</div>
          <hr className="border-white/15 mb-2" />
          <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">Not on OSM</div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-dashed border-red-400 bg-red-200/30 inline-block" /> Unverified
          </div>
        </div>
      </div>

      {/* Unverified panel */}
      {unverifiedLocations.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors"
            onClick={() => setShowUnv(p => !p)}>
            <span className="text-amber-600 font-semibold text-sm">
              ⚠ Unverified Locations ({unverifiedLocations.length})
              <span className="ml-2 text-[10px] font-normal text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">not found on OSM</span>
            </span>
            <button className="text-amber-600 text-xs hover:text-amber-800">
              {showUnv ? 'Hide' : 'Show'} on map
            </button>
          </div>
          {showUnv && (
            <div className="p-4">
              <p className="text-xs text-slate-500 mb-3">
                These locations were extracted but could not be verified on OpenStreetMap.
                They appear as dashed red circles near district centres.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                {unverifiedLocations.map(uv => (
                  <div key={uv.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="w-7 h-7 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-red-500 text-xs font-bold">?</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-800 truncate">{uv.extractedLocation || '—'}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 break-words">
                        "{(uv.originalText || '').slice(0, 60)}{(uv.originalText?.length || 0) > 60 ? '…' : ''}"
                      </div>
                      <div className="text-[10px] text-red-500 mt-1">{uv.reason}</div>
                      {uv.attemptedQueries?.length
                        ? <div className="text-[10px] text-slate-400 mt-0.5">Tried: {uv.attemptedQueries.join('; ')}</div>
                        : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="flex gap-3 flex-wrap text-xs">
        {osmC > 0 && <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-slate-600"><span className="w-2 h-2 rounded-full bg-green-500" />{osmC} OSM verified</div>}
        {locC > 0 && <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-slate-600"><span className="w-2 h-2 rounded-full bg-blue-500" />{locC} local database</div>}
        {estC > 0 && <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400" />{estC} estimated</div>}
        {unverifiedLocations.length > 0 && <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200 text-amber-600"><span className="w-2 h-2 rounded-full bg-red-400" />{unverifiedLocations.length} unverified</div>}
      </div>
    </div>
  );
}
