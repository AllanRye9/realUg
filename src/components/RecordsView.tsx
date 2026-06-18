import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Listing } from '@/types';
import { ALL_DISTRICTS, DISTRICT_CENTRES } from '@/lib/ugandaData';
import { splitListingsAdvanced, parseFull } from '@/lib/parser';
import { geocodeWithVariations, getFallbackCoords } from '@/lib/geocoding';
import { learner, computeQualityScore } from '@/lib/learningEngine';

interface UnverifiedItem {
  id: number;
  originalText: string;
  extractedLocation: string;
  reason: string;
  attemptedQueries?: string[];
}

interface RecordsViewProps {
  listings: Listing[];
  onAddOrUpdate: (listing: Listing) => void;
  onDelete: (id: number) => void;
  onDeleteAll: () => void;
  onSelect: (listing: Listing) => void;
  onSetTab: (tab: string) => void;
  unverifiedLocations: UnverifiedItem[];
  onSetUnverified: (items: UnverifiedItem[]) => void;
}

export default function RecordsView({
  listings,
  onAddOrUpdate,
  onDelete,
  onDeleteAll,
  onSelect,
  onSetTab,
  unverifiedLocations,
  onSetUnverified,
}: RecordsViewProps) {
  const [rawText, setRawText] = useState('');
  const [parseQueue, setParseQueue] = useState<Listing[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState('');
  const [parseMsgType, setParseMsgType] = useState<'info' | 'success' | 'error'>('info');
  const [fallbackDistrict, setFallbackDistrict] = useState('Gulu');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Manual entry state
  const [manTitle, setManTitle] = useState('');
  const [manPrice, setManPrice] = useState('');
  const [manSize, setManSize] = useState('');
  const [manArea, setManArea] = useState('Gulu');
  const [manStatus, setManStatus] = useState<'sold' | 'unsold'>('unsold');
  const [manInterest, setManInterest] = useState<'high' | 'medium' | 'low'>('medium');
  const [manVillage, setManVillage] = useState('');
  const [manAgent, setManAgent] = useState('');
  const [manContact, setManContact] = useState('');

  function setMsg(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    setParseMsg(msg);
    setParseMsgType(type);
  }

  const handleParse = async () => {
    if (!rawText.trim()) return;

    // Cancel any in-progress parse
    abortRef.current.cancelled = true;
    const token = { cancelled: false };
    abortRef.current = token;

    setParsing(true);
    setMsg('Analysing raw text...');
    setParseQueue([]);
    onSetUnverified([]);

    const blocks = splitListingsAdvanced(rawText);

    if (blocks.length === 0) {
      setMsg('No valid property listings detected. Check the text format.', 'error');
      setParsing(false);
      return;
    }

    setMsg(`Found ${blocks.length} potential listing${blocks.length !== 1 ? 's' : ''}. Geocoding...`);

    const parsedListings: Listing[] = [];
    const newUnverified: UnverifiedItem[] = [];

    for (let i = 0; i < blocks.length; i++) {
      if (token.cancelled) break;

      const block = blocks[i];
      let info;
      try {
        ({ info } = parseFull(block, fallbackDistrict));
      } catch (err) {
        console.warn('[RecordsView] parseFull error on block', i, err);
        continue;
      }

      setMsg(`Parsing ${i + 1}/${blocks.length}: ${info.title.slice(0, 40)}...`);

      let lat = 0;
      let lng = 0;
      let geocoded = false;
      let geocodeSource: 'osm' | 'local' | 'fallback' = 'fallback';

      if (info.village) {
        try {
          const geoResult = await geocodeWithVariations(info.village, info.district);
          if (token.cancelled) break;

          if (geoResult.result) {
            lat = geoResult.result.lat;
            lng = geoResult.result.lng;
            geocoded = geoResult.result.source === 'osm' || geoResult.result.source === 'local';
            geocodeSource = geoResult.result.source as 'osm' | 'local' | 'fallback';
          } else {
            newUnverified.push({
              id: Date.now() + Math.random(),
              originalText: block,
              extractedLocation: info.village,
              reason: `"${info.village}" not found in OSM for ${info.district}`,
              attemptedQueries: geoResult.attemptedQueries,
            });
          }
        } catch (err) {
          console.warn('[RecordsView] geocodeWithVariations error:', err);
          newUnverified.push({
            id: Date.now() + Math.random(),
            originalText: block,
            extractedLocation: info.village,
            reason: 'Geocoding error — network issue',
            attemptedQueries: [],
          });
        }
      }

      // Fallback to district centre if no valid coords
      if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) {
        const fallback = getFallbackCoords(info.district);
        lat = fallback.lat;
        lng = fallback.lng;
        geocodeSource = 'fallback';
        geocoded = false;
      }

      const listing: Listing = {
        id: Date.now() + Math.random(),
        title: info.title,
        priceUGX: info.price || 0,
        areaName: info.district,
        suburb: '',
        status: info.status,
        interest: info.interest,
        size: info.sizeDisplay || 'unknown',
        lat,
        lng,
        posts: 1,
        agent: info.agent || '',
        contact: info.phone || '',
        notes: block.slice(0, 200),
        village: info.village || '',
        district: info.district,
        _geocoded: geocoded,
        _geocodeSource: geocodeSource,
      };

      parsedListings.push(listing);

      // Nominatim rate-limit: 250ms between requests (OSM's 1-req/sec policy)
      if (i < blocks.length - 1 && info.village) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    if (token.cancelled) {
      setParsing(false);
      return;
    }

    // Sort by quality score descending
    parsedListings.sort((a, b) => computeQualityScore(b) - computeQualityScore(a));

    setParseQueue(parsedListings);
    onSetUnverified(newUnverified);

    const verifiedCount = parsedListings.filter(l => l._geocoded).length;
    const localCount = parsedListings.filter(l => l._geocodeSource === 'local').length;
    setMsg(
      `Parsed ${parsedListings.length} listing${parsedListings.length !== 1 ? 's' : ''} ` +
      `(${verifiedCount + localCount} geocoded, ${newUnverified.length} unverified locations)`,
      parsedListings.length > 0 ? 'success' : 'error'
    );
    setParsing(false);
  };

  const addAllFromQueue = useCallback(() => {
    if (parseQueue.length === 0) {
      setMsg('No listings in queue', 'error');
      return;
    }
    const count = parseQueue.length;
    parseQueue.forEach(l => {
      learner.learn(l, computeQualityScore(l));
      onAddOrUpdate(l);
    });
    setParseQueue([]);
    setRawText('');
    setMsg(`Added ${count} listing${count !== 1 ? 's' : ''}! AI patterns updated.`, 'success');
  }, [parseQueue, onAddOrUpdate]);

  const handleManualAdd = useCallback(() => {
    if (!manTitle.trim()) {
      setMsg('Please fill in a title', 'error');
      return;
    }
    const priceValue = parseFloat(manPrice);
    if (isNaN(priceValue) || priceValue < 0) {
      setMsg('Please enter a valid price (0 or more)', 'error');
      return;
    }

    const centre = DISTRICT_CENTRES[manArea] || DISTRICT_CENTRES['Gulu'];
    const newListing: Listing = {
      id: Date.now() + Math.random(),
      title: manTitle.trim(),
      priceUGX: priceValue,
      areaName: manArea,
      suburb: '',
      status: manStatus,
      interest: manInterest,
      size: manSize.trim() || 'unknown',
      lat: centre.lat,
      lng: centre.lng,
      posts: 1,
      agent: manAgent.trim() || '',
      contact: manContact.trim() || '',
      village: manVillage.trim() || '',
      district: manArea,
      notes: '',
      _geocodeSource: 'fallback',
    };

    learner.learn(newListing, computeQualityScore(newListing));
    onAddOrUpdate(newListing);
    setMsg(`Added: ${manTitle} (${priceValue}M UGX)`, 'success');

    // Reset form
    setManTitle('');
    setManPrice('');
    setManSize('');
    setManVillage('');
    setManAgent('');
    setManContact('');
  }, [manTitle, manPrice, manSize, manArea, manStatus, manInterest, manVillage, manAgent, manContact, onAddOrUpdate]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'csv') {
      setMsg('Please upload a .txt or .csv file', 'error');
      e.target.value = '';
      return;
    }

    if (file.size > 1_000_000) {
      setMsg('File too large (max 1 MB)', 'error');
      e.target.value = '';
      return;
    }

    try {
      const content = await file.text();
      setRawText(content);
      setMsg(`Loaded ${file.name} (${content.split('\n').length} lines) — click Parse & Geocode`, 'info');
    } catch {
      setMsg('Failed to read file', 'error');
    }
    e.target.value = '';
  };

  const filtered = listings.filter(l => {
    if (!l) return false;
    const q = search.toLowerCase();
    const ms = !q ||
      (l.title || '').toLowerCase().includes(q) ||
      (l.areaName || '').toLowerCase().includes(q) ||
      (l.village || '').toLowerCase().includes(q) ||
      (l.agent || '').toLowerCase().includes(q);
    const mst = statusFilter === 'all' || l.status === statusFilter;
    const ma = areaFilter === 'all' || l.areaName === areaFilter;
    return ms && mst && ma;
  });

  const msgClass =
    parseMsgType === 'success'
      ? 'text-green-600'
      : parseMsgType === 'error'
      ? 'text-red-500'
      : 'text-slate-500';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      {/* Left Panel */}
      <div className="flex flex-col gap-4">
        {/* AI Parser */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">AI-Powered Parser</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Paste raw listings. The parser extracts size, location, price, and agent info,
              then geocodes each property against OpenStreetMap.
            </p>

            <select
              value={fallbackDistrict}
              onChange={e => setFallbackDistrict(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none focus:border-slate-400"
            >
              {ALL_DISTRICTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <Textarea
              rows={5}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={`Paste listings here...\n• 2 acres in Pece, Gulu city, UGX 220M. Call Andrew 0772123456\nLand 30x30m in Laroo, 350M, contact Billy\nPlot in Abwoch, 0.5 acres, UGX 180M — 0772987654\n3 acres at Koro, Omoro, 23m`}
              className="text-xs resize-none"
            />

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={handleParse}
                disabled={parsing || !rawText.trim()}
                size="sm"
                className="text-xs"
              >
                {parsing ? 'Parsing…' : 'Parse & Geocode'}
              </Button>
              {parsing && (
                <Button
                  onClick={() => { abortRef.current.cancelled = true; setParsing(false); setMsg('Cancelled', 'error'); }}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  Cancel
                </Button>
              )}
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" className="text-xs" asChild>
                  <span>Upload File</span>
                </Button>
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {parseMsg && (
              <p className={`text-xs ${msgClass}`}>{parseMsg}</p>
            )}

            {/* Parse Queue */}
            {parseQueue.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Queue ({parseQueue.length})</span>
                  <Button onClick={addAllFromQueue} size="sm" className="text-xs h-7">
                    Add All
                  </Button>
                </div>
                {parseQueue.map((l, i) => (
                  <div
                    key={l.id}
                    className={`p-2 rounded-lg text-xs ${
                      i < 3 ? 'bg-green-50 border border-green-200' : 'bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-medium truncate flex-1">{l.title}</span>
                      <span className="text-slate-600 shrink-0 ml-2">
                        {l.priceUGX > 0 ? `UGX ${l.priceUGX}M` : 'No price'}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      {l.size} · {l.areaName}
                      {l.village ? ` · ${l.village}` : ''}
                      {l._geocoded ? (
                        <span className="text-green-600 ml-1">✓ OSM</span>
                      ) : l._geocodeSource === 'local' ? (
                        <span className="text-blue-600 ml-1">✓ local</span>
                      ) : (
                        <span className="text-amber-600 ml-1">~ estimated</span>
                      )}
                    </div>
                    <Button
                      onClick={() => {
                        learner.learn(l, computeQualityScore(l));
                        onAddOrUpdate(l);
                        setParseQueue(q => q.filter((_, j) => j !== i));
                      }}
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6 mt-1 px-2"
                    >
                      Add This
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual Entry */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Manual Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Title (e.g. 3 acres in Gulu)"
              value={manTitle}
              onChange={e => setManTitle(e.target.value)}
              className="text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="0"
                placeholder="Price (UGX M)"
                value={manPrice}
                onChange={e => setManPrice(e.target.value)}
                className="text-xs"
              />
              <Input
                placeholder="Size (e.g. 30x30, 0.5 acre)"
                value={manSize}
                onChange={e => setManSize(e.target.value)}
                className="text-xs"
              />
            </div>
            <Input
              placeholder="Village/Area (e.g. Pece, Laroo)"
              value={manVillage}
              onChange={e => setManVillage(e.target.value)}
              className="text-xs"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Agent name"
                value={manAgent}
                onChange={e => setManAgent(e.target.value)}
                className="text-xs"
              />
              <Input
                placeholder="Contact number"
                value={manContact}
                onChange={e => setManContact(e.target.value)}
                className="text-xs"
              />
            </div>
            <select
              value={manArea}
              onChange={e => setManArea(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none"
            >
              {ALL_DISTRICTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div className="flex gap-2">
              {(['unsold', 'sold'] as const).map(s => (
                <Button
                  key={s}
                  onClick={() => setManStatus(s)}
                  variant={manStatus === s ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs flex-1 capitalize"
                >
                  {s}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as const).map(lvl => (
                <Button
                  key={lvl}
                  onClick={() => setManInterest(lvl)}
                  variant={manInterest === lvl ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs flex-1 capitalize"
                >
                  {lvl}
                </Button>
              ))}
            </div>
            <Button onClick={handleManualAdd} size="sm" className="w-full text-xs">
              Add & Learn
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel — Property Log */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold">
              Property Log ({filtered.length}{filtered.length !== listings.length ? ` of ${listings.length}` : ''})
            </CardTitle>
            <Button
              onClick={onDeleteAll}
              variant="ghost"
              size="sm"
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
              disabled={listings.length === 0}
            >
              Delete All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="flex-1 min-w-[120px]">
              <Input
                placeholder="Search title, area, agent…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="text-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none"
            >
              <option value="all">All status</option>
              <option value="unsold">Unsold</option>
              <option value="sold">Sold</option>
            </select>
            <select
              value={areaFilter}
              onChange={e => setAreaFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none"
            >
              <option value="all">All areas</option>
              {[...new Set(listings.map(l => l?.areaName).filter(Boolean))].sort().map(a => (
                <option key={a} value={a!}>{a}</option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-2 font-semibold">Title</th>
                  <th className="text-left p-2 font-semibold">Area</th>
                  <th className="text-left p-2 font-semibold">Price</th>
                  <th className="text-left p-2 font-semibold">Status</th>
                  <th className="text-left p-2 font-semibold w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      {listings.length === 0
                        ? 'No listings yet. Add some via the parser or manual entry.'
                        : 'No listings match the current filter.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(l => (
                    <tr
                      key={l.id}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => { onSelect(l); onSetTab('map'); }}
                    >
                      <td className="p-2">
                        <div className="font-medium">{l.title}</div>
                        <div className="text-slate-500 flex gap-1 flex-wrap items-center">
                          {l.village && <span>· {l.village}</span>}
                          {(l.posts || 1) > 1 && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1">+{l.posts}</Badge>
                          )}
                          {l._geocoded && (
                            <Badge className="text-[9px] h-4 px-1 bg-green-100 text-green-700 hover:bg-green-100">OSM</Badge>
                          )}
                          {!l._geocoded && l._geocodeSource === 'local' && (
                            <Badge className="text-[9px] h-4 px-1 bg-blue-100 text-blue-700 hover:bg-blue-100">local</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-slate-600">{l.areaName}</td>
                      <td className="p-2 font-medium">
                        {l.priceUGX > 0 ? `UGX ${l.priceUGX}M` : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={l.status === 'sold' ? 'destructive' : 'default'}
                          className="text-[10px] capitalize"
                        >
                          {l.status}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(l.id); }}
                          className="text-red-400 hover:text-red-600 transition-colors"
                          aria-label="Delete listing"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
