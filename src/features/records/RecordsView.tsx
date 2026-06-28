/**
 * features/records/RecordsView.tsx
 *
 * Improvements:
 *  - OSM-verified rows grouped ABOVE a gradient divider line
 *  - Unverified rows grouped BELOW with red section header
 *  - Source badge (OSM / local / est.) shown on every row
 *  - CSV file upload flattens columns into space-separated text
 *  - Geocode source filter added to filter bar
 *  - Progress bar during geocoding
 *  - Cancel button for long parse runs
 */
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

interface Props {
  listings: Listing[];
  onAddOrUpdate: (l: Listing) => void;
  onDelete: (id: number) => void;
  onDeleteAll: () => void;
  onSelect: (l: Listing) => void;
  onSetTab: (tab: string) => void;
  onSetUnverified: (items: UnverifiedItem[]) => void;
}

// ── Source badge ────────────────────────────────────────────────────
function SrcBadge({ l }: { l: Listing }) {
  if (l._geocoded)
    return <Badge className="text-[9px] h-4 px-1 bg-green-100 text-green-700 hover:bg-green-100">OSM</Badge>;
  if (l._geocodeSource === 'local')
    return <Badge className="text-[9px] h-4 px-1 bg-blue-100 text-blue-700 hover:bg-blue-100">local</Badge>;
  return <Badge className="text-[9px] h-4 px-1 bg-slate-100 text-slate-500 hover:bg-slate-100">est.</Badge>;
}

// ── Divider between OSM-verified and unverified rows ────────────────
function OsmDivider({ vCount, uCount }: { vCount: number; uCount: number }) {
  return (
    <tr>
      <td colSpan={5} className="py-0 px-3">
        <div className="relative flex items-center my-2">
          <div className="flex-1 h-px bg-gradient-to-r from-green-400 via-green-200 to-transparent" />
          <span className="mx-3 text-[10px] text-slate-400 border border-slate-200 rounded-full px-2 py-0.5 bg-white whitespace-nowrap">
            ⬆ {vCount} OSM verified &nbsp;·&nbsp; {uCount} unverified ⬇
          </span>
          <div className="flex-1 h-px bg-gradient-to-l from-red-400 via-red-200 to-transparent" />
        </div>
      </td>
    </tr>
  );
}

// ── Section header row ───────────────────────────────────────────────
function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <tr>
      <td colSpan={5} className="px-3 pt-3 pb-1">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${color}`}>{label}</span>
      </td>
    </tr>
  );
}

export default function RecordsView({ listings, onAddOrUpdate, onDelete, onDeleteAll, onSelect, onSetTab, onSetUnverified }: Props) {
  const [rawText,     setRawText]     = useState('');
  const [parseQueue,  setParseQueue]  = useState<Listing[]>([]);
  const [parsing,     setParsing]     = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [parseMsg,    setParseMsg]    = useState('');
  const [msgType,     setMsgType]     = useState<'info'|'success'|'error'>('info');
  const [fallback,    setFallback]    = useState('Gulu');
  const [search,      setSearch]      = useState('');
  const [statusF,     setStatusF]     = useState('all');
  const [srcF,        setSrcF]        = useState('all');
  const [areaF,       setAreaF]       = useState('all');
  const abortRef = useRef({ cancelled: false });

  // manual entry
  const [manTitle,   setManTitle]   = useState('');
  const [manPrice,   setManPrice]   = useState('');
  const [manSize,    setManSize]    = useState('');
  const [manArea,    setManArea]    = useState('Gulu');
  const [manStatus,  setManStatus]  = useState<'sold'|'unsold'>('unsold');
  const [manInt,     setManInt]     = useState<'high'|'medium'|'low'>('medium');
  const [manVillage, setManVillage] = useState('');
  const [manAgent,   setManAgent]   = useState('');
  const [manContact, setManContact] = useState('');

  function msg(text: string, type: 'info'|'success'|'error' = 'info') {
    setParseMsg(text); setMsgType(type);
  }

  // ── Parse & geocode ─────────────────────────────────────────────────
  const handleParse = async () => {
    if (!rawText.trim()) return;
    abortRef.current.cancelled = true;
    const token = { cancelled: false };
    abortRef.current = token;
    setParsing(true); setParseQueue([]); onSetUnverified([]); setProgress(0);
    msg('Analysing text…');

    const blocks = splitListingsAdvanced(rawText);
    if (!blocks.length) { msg('No valid property listings detected. Ensure text has size, location and price.', 'error'); setParsing(false); return; }
    msg(`Found ${blocks.length} listing${blocks.length > 1 ? 's' : ''}. Geocoding via OSM…`);

    const results: Listing[]       = [];
    const newUnv:  UnverifiedItem[] = [];

    for (let i = 0; i < blocks.length; i++) {
      if (token.cancelled) break;
      setProgress(Math.round(((i + 1) / blocks.length) * 100));

      let info;
      try { ({ info } = parseFull(blocks[i], fallback)); }
      catch (e) { console.warn('[parse]', e); continue; }

      msg(`Geocoding ${i + 1}/${blocks.length}: ${info.title.slice(0, 40)}…`);

      let lat = 0, lng = 0, geocoded = false;
      let geocodeSource: 'osm' | 'local' | 'fallback' = 'fallback';

      if (info.village) {
        try {
          const { result, attemptedQueries } = await geocodeWithVariations(info.village, info.district);
          if (token.cancelled) break;
          if (result) {
            lat = result.lat; lng = result.lng;
            geocoded = result.source === 'osm' || result.source === 'local';
            geocodeSource = result.source as 'osm' | 'local' | 'fallback';
          } else {
            newUnv.push({ id: Date.now() + Math.random(), originalText: blocks[i], extractedLocation: info.village, reason: `"${info.village}" not found in OSM for ${info.district}`, attemptedQueries });
          }
        } catch { newUnv.push({ id: Date.now() + Math.random(), originalText: blocks[i], extractedLocation: info.village, reason: 'Geocoding error — network issue', attemptedQueries: [] }); }
      }

      if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) {
        const fb = getFallbackCoords(info.district);
        lat = fb.lat; lng = fb.lng; geocodeSource = 'fallback'; geocoded = false;
      }

      results.push({
        id: Date.now() + Math.random() + i,
        title: info.title, priceUGX: info.price || 0, areaName: info.district, suburb: '',
        status: info.status, interest: info.interest,
        size: info.sizeDisplay || 'unknown', lat, lng, posts: 1,
        agent: info.agent || '', contact: info.phone || '',
        notes: blocks[i].slice(0, 200), village: info.village || '', district: info.district,
        _geocoded: geocoded, _geocodeSource: geocodeSource,
      });
    }

    if (token.cancelled) { setParsing(false); return; }

    // Sort: geocoded first, then by price desc
    results.sort((a, b) => {
      if (a._geocoded !== b._geocoded) return a._geocoded ? -1 : 1;
      return b.priceUGX - a.priceUGX;
    });

    setParseQueue(results);
    onSetUnverified(newUnv);

    const osmC = results.filter(r => r._geocoded).length;
    const locC = results.filter(r => r._geocodeSource === 'local').length;
    msg(
      `Parsed ${results.length} listing${results.length !== 1 ? 's' : ''} — ${osmC} OSM, ${locC} local, ${newUnv.length} unverified`,
      results.length > 0 ? 'success' : 'error'
    );
    setProgress(0);
    setParsing(false);
  };

  const addAllQueue = useCallback(() => {
    parseQueue.forEach(l => { learner.learn(l, computeQualityScore(l)); onAddOrUpdate(l); });
    setParseQueue([]);
    setRawText('');
    msg(`Added ${parseQueue.length} listing${parseQueue.length !== 1 ? 's' : ''}`, 'success');
  }, [parseQueue, onAddOrUpdate]);

  // ── Manual add ───────────────────────────────────────────────────────
  const handleManualAdd = useCallback(() => {
    if (!manTitle.trim()) { msg('Please fill in a title', 'error'); return; }
    const price = parseFloat(manPrice);
    if (isNaN(price) || price < 0) { msg('Enter a valid price', 'error'); return; }
    const c = DISTRICT_CENTRES[manArea] || DISTRICT_CENTRES['Gulu'];
    const l: Listing = {
      id: Date.now() + Math.random(), title: manTitle.trim(), priceUGX: price,
      areaName: manArea, suburb: '', status: manStatus, interest: manInt,
      size: manSize.trim() || 'unknown', lat: c.lat, lng: c.lng, posts: 1,
      agent: manAgent.trim(), contact: manContact.trim(),
      village: manVillage.trim(), district: manArea, notes: '',
      _geocodeSource: 'fallback',
    };
    learner.learn(l, computeQualityScore(l));
    onAddOrUpdate(l);
    msg(`Added: ${manTitle}`, 'success');
    setManTitle(''); setManPrice(''); setManSize(''); setManVillage(''); setManAgent(''); setManContact('');
  }, [manTitle, manPrice, manSize, manArea, manStatus, manInt, manVillage, manAgent, manContact, onAddOrUpdate]);

  // ── File upload (txt + csv) ──────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'txt' && ext !== 'csv') { msg('Only .txt or .csv files accepted', 'error'); e.target.value = ''; return; }
    if (f.size > 2_000_000) { msg('File too large (max 2 MB)', 'error'); e.target.value = ''; return; }
    try {
      let text = await f.text();
      // Flatten CSV rows into space-separated text
      if (ext === 'csv') {
        text = text.split(/\r?\n/).filter(l => l.trim())
          .map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()).join(' '))
          .join('\n');
      }
      setRawText(text);
      msg(`Loaded ${f.name} (${text.split('\n').length} lines) — click Parse & Geocode`, 'info');
    } catch { msg('Failed to read file', 'error'); }
    e.target.value = '';
  };

  // ── Filter ───────────────────────────────────────────────────────────
  const filtered = listings.filter(l => {
    if (!l) return false;
    const q = search.toLowerCase();
    const mq = !q || [l.title, l.areaName, l.village, l.agent].some(s => (s||'').toLowerCase().includes(q));
    const ms = statusF === 'all' || l.status === statusF;
    const mg = srcF    === 'all' || l._geocodeSource === srcF || (srcF === 'osm' && l._geocoded);
    const ma = areaF   === 'all' || l.areaName === areaF;
    return mq && ms && mg && ma;
  });

  const verifiedRows   = filtered.filter(l =>  l._geocoded || l._geocodeSource === 'local');
  const unverifiedRows = filtered.filter(l => !l._geocoded && l._geocodeSource !== 'local');
  const hasBoth        = verifiedRows.length > 0 && unverifiedRows.length > 0;

  const msgCls = msgType === 'success' ? 'text-green-600' : msgType === 'error' ? 'text-red-500' : 'text-slate-500';

  // ── Row renderer ─────────────────────────────────────────────────────
  const renderRow = (l: Listing) => (
    <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
      onClick={() => { onSelect(l); onSetTab('map'); }}>
      <td className="p-2">
        <div className="font-medium leading-tight">{l.title}</div>
        <div className="text-slate-500 flex gap-1 flex-wrap items-center mt-0.5">
          {l.village && <span>· {l.village}</span>}
          {(l.posts || 1) > 1 && <Badge variant="secondary" className="text-[9px] h-4 px-1">+{l.posts}</Badge>}
          <SrcBadge l={l} />
        </div>
      </td>
      <td className="p-2 text-slate-600 text-xs">{l.areaName}</td>
      <td className="p-2 font-medium text-xs">{l.priceUGX > 0 ? `UGX ${l.priceUGX}M` : <span className="text-slate-400">—</span>}</td>
      <td className="p-2">
        <Badge variant={l.status === 'sold' ? 'destructive' : 'default'} className="text-[10px] capitalize">{l.status}</Badge>
      </td>
      <td className="p-2">
        <button onClick={e => { e.stopPropagation(); onDelete(l.id); }}
          className="text-red-400 hover:text-red-600 transition-colors" aria-label="Delete">✕</button>
      </td>
    </tr>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">

      {/* ── Left panel ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">

        {/* Parser card */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">AI-Powered Parser</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Paste raw listings or upload a <code>.txt</code> / <code>.csv</code> file.
              The parser extracts size, price, location and agent, then geocodes via OSM.
              Non-property lines are silently rejected.
            </p>

            <select value={fallback} onChange={e => setFallback(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none focus:border-slate-400">
              {ALL_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>

            <Textarea rows={5} value={rawText} onChange={e => setRawText(e.target.value)}
              placeholder={`Paste listings here…\n• 2 acres in Pece, Gulu city, UGX 220M. Call Andrew 0772123456\nLand 30x30m in Laroo, 350M, contact Billy\nPlot in Abwoch, 0.5 acres, UGX 180M — 0772987654\n3 acres at Koro, Omoro, 23m`}
              className="text-xs resize-none" />

            {/* Progress bar */}
            {parsing && progress > 0 && (
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleParse} disabled={parsing || !rawText.trim()} size="sm" className="text-xs">
                {parsing ? 'Parsing…' : 'Parse & Geocode'}
              </Button>
              {parsing && (
                <Button onClick={() => { abortRef.current.cancelled = true; setParsing(false); setProgress(0); msg('Cancelled', 'error'); }}
                  variant="outline" size="sm" className="text-xs">Cancel</Button>
              )}
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" className="text-xs" asChild><span>Upload file</span></Button>
                <input type="file" accept=".txt,.csv" onChange={handleFile} className="hidden" />
              </label>
            </div>

            {parseMsg && <p className={`text-xs ${msgCls}`}>{parseMsg}</p>}

            {/* Parse queue */}
            {parseQueue.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-3 space-y-2 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Queue ({parseQueue.length})</span>
                  <Button onClick={addAllQueue} size="sm" className="text-xs h-7">Add all</Button>
                </div>

                {/* Verified in queue */}
                {parseQueue.filter(l => l._geocoded || l._geocodeSource === 'local').length > 0 && (
                  <div className="text-[10px] font-semibold text-green-700 uppercase tracking-widest mb-1">
                    ✓ OSM verified
                  </div>
                )}
                {parseQueue.filter(l => l._geocoded || l._geocodeSource === 'local').map((l) => (
                  <div key={l.id} className="p-2 rounded-lg bg-green-50 border border-green-100 text-xs">
                    <div className="flex justify-between items-start">
                      <span className="font-medium truncate flex-1">{l.title}</span>
                      <span className="text-slate-600 shrink-0 ml-2">{l.priceUGX > 0 ? `UGX ${l.priceUGX}M` : '—'}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                      {l.size} · {l.areaName}{l.village ? ` · ${l.village}` : ''} <SrcBadge l={l} />
                    </div>
                    <Button onClick={() => { learner.learn(l, computeQualityScore(l)); onAddOrUpdate(l); setParseQueue(q => q.filter((_, j) => j !== parseQueue.indexOf(l))); }}
                      variant="ghost" size="sm" className="text-xs h-6 mt-1 px-2">Add this</Button>
                  </div>
                ))}

                {/* Unverified in queue */}
                {parseQueue.filter(l => !l._geocoded && l._geocodeSource !== 'local').length > 0 && (
                  <>
                    <div className="h-px bg-slate-200 my-1" />
                    <div className="text-[10px] font-semibold text-red-600 uppercase tracking-widest mb-1">⚠ Unverified</div>
                    {parseQueue.filter(l => !l._geocoded && l._geocodeSource !== 'local').map((l) => (
                      <div key={l.id} className="p-2 rounded-lg bg-slate-50 text-xs">
                        <div className="flex justify-between items-start">
                          <span className="font-medium truncate flex-1">{l.title}</span>
                          <span className="text-slate-600 shrink-0 ml-2">{l.priceUGX > 0 ? `UGX ${l.priceUGX}M` : '—'}</span>
                        </div>
                        <div className="text-slate-500 mt-0.5 flex items-center gap-1 flex-wrap">
                          {l.size} · {l.areaName}{l.village ? ` · ${l.village}` : ''} <SrcBadge l={l} />
                        </div>
                        <Button onClick={() => { learner.learn(l, computeQualityScore(l)); onAddOrUpdate(l); setParseQueue(q => q.filter(x => x.id !== l.id)); }}
                          variant="ghost" size="sm" className="text-xs h-6 mt-1 px-2">Add this</Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual entry card */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Manual Entry</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Title (e.g. 3 acres in Gulu)" value={manTitle} onChange={e => setManTitle(e.target.value)} className="text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min="0" placeholder="Price (UGX M)" value={manPrice} onChange={e => setManPrice(e.target.value)} className="text-xs" />
              <Input placeholder="Size (e.g. 30x30m, 0.5 acre)" value={manSize} onChange={e => setManSize(e.target.value)} className="text-xs" />
            </div>
            <Input placeholder="Village / Area (e.g. Pece, Laroo)" value={manVillage} onChange={e => setManVillage(e.target.value)} className="text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Agent name" value={manAgent} onChange={e => setManAgent(e.target.value)} className="text-xs" />
              <Input placeholder="Contact number" value={manContact} onChange={e => setManContact(e.target.value)} className="text-xs" />
            </div>
            <select value={manArea} onChange={e => setManArea(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none">
              {ALL_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="flex gap-2">
              {(['unsold','sold'] as const).map(s => (
                <Button key={s} onClick={() => setManStatus(s)} variant={manStatus === s ? 'default' : 'outline'} size="sm" className="text-xs flex-1 capitalize">{s}</Button>
              ))}
            </div>
            <div className="flex gap-2">
              {(['high','medium','low'] as const).map(v => (
                <Button key={v} onClick={() => setManInt(v)} variant={manInt === v ? 'default' : 'outline'} size="sm" className="text-xs flex-1 capitalize">{v}</Button>
              ))}
            </div>
            <Button onClick={handleManualAdd} size="sm" className="w-full text-xs">Add &amp; Learn</Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Right panel — Property Log ─────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold">
              Property Log ({filtered.length}{filtered.length !== listings.length ? ` of ${listings.length}` : ''})
            </CardTitle>
            <Button onClick={onDeleteAll} variant="ghost" size="sm"
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50" disabled={listings.length === 0}>
              Delete all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <Input placeholder="Search title, area, agent…" value={search} onChange={e => setSearch(e.target.value)} className="text-xs flex-1 min-w-[120px]" />
            <select value={statusF} onChange={e => setStatusF(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none">
              <option value="all">All status</option>
              <option value="unsold">Unsold</option>
              <option value="sold">Sold</option>
            </select>
            <select value={srcF} onChange={e => setSrcF(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none">
              <option value="all">All sources</option>
              <option value="osm">OSM verified</option>
              <option value="local">Local DB</option>
              <option value="fallback">Estimated</option>
            </select>
            <select value={areaF} onChange={e => setAreaF(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none">
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
                  <th className="w-8 p-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      {listings.length === 0 ? 'No listings yet. Use the parser or manual entry.' : 'No listings match the current filters.'}
                    </td>
                  </tr>
                ) : (
                  <>
                    {verifiedRows.length > 0 && (
                      <SectionHeader label={`✓ OSM verified — ${verifiedRows.length}`} color="text-green-700" />
                    )}
                    {verifiedRows.map(renderRow)}

                    {hasBoth && <OsmDivider vCount={verifiedRows.length} uCount={unverifiedRows.length} />}

                    {unverifiedRows.length > 0 && (
                      <SectionHeader label={`⚠ Unverified location — ${unverifiedRows.length}`} color="text-red-600" />
                    )}
                    {unverifiedRows.map(renderRow)}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
