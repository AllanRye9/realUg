import { useState, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Listing } from '@/types';
import { DISTRICT_CENTRES } from '@/lib/ugandaData';
import { learner, computeQualityScore } from '@/lib/learningEngine';
import MapView from '@/components/MapView';
import RecordsView from '@/components/RecordsView';
import AnalyticsView from '@/components/AnalyticsView';
import ValuationView from '@/components/ValuationView';
import MemoryView from '@/components/MemoryView';
import './App.css';

function safeJSONParse<T>(str: string, defaultVal: T): T {
  try { return JSON.parse(str) as T; } catch { return defaultVal; }
}
function safeLocalStorageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalStorageSet(key: string, val: string): boolean {
  try { localStorage.setItem(key, val); return true; } catch { return false; }
}
function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function sanitizeListing(l: Record<string, unknown>): Listing | null {
  if (!l || typeof l !== 'object') return null;
  const price = toNum(l.priceUGX, 0);
  const areaName = String(l.areaName || 'Gulu');
  const centre = DISTRICT_CENTRES[areaName] || DISTRICT_CENTRES['Gulu'];

  return {
    id: toNum(l.id, Date.now() + Math.random()),
    title: String(l.title || 'Untitled Property'),
    priceUGX: price > 0 ? price : 1,
    areaName,
    suburb: String(l.suburb || ''),
    status: ['sold', 'unsold'].includes(String(l.status)) ? (l.status as 'sold' | 'unsold') : 'unsold',
    interest: ['high', 'medium', 'low'].includes(String(l.interest)) ? (l.interest as 'high' | 'medium' | 'low') : 'medium',
    size: String(l.size || 'unknown'),
    lat: toNum(l.lat, centre.lat),
    lng: toNum(l.lng, centre.lng),
    posts: toNum(l.posts, 1),
    agent: String(l.agent || ''),
    contact: String(l.contact || ''),
    notes: String(l.notes || ''),
    village: String(l.village || ''),
    district: String(l.district || l.areaName || 'Gulu'),
    _geocoded: Boolean(l._geocoded),
    _geocodeSource: (l._geocodeSource as 'osm' | 'local' | 'fallback') || 'fallback',
  };
}

export default function App() {
  const [listings, setListings] = useState<Listing[]>(() => {
    try {
      const saved = safeLocalStorageGet('ug_persist_v4');
      if (saved) {
        const parsed = safeJSONParse<unknown[]>(saved, []);
        const arr = Array.isArray(parsed) ? parsed : [];
        const cleaned = arr.map(item => sanitizeListing(item as Record<string, unknown>)).filter(Boolean) as Listing[];
        // Learn from loaded listings
        cleaned.forEach(l => {
          if (learner.knowledge.processedCount === 0) {
            learner.learn(l, computeQualityScore(l));
          }
        });
        return cleaned;
      }
    } catch { /* ignore */ }
    return [];
  });

  const [tab, setTab] = useState('map');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [syncMsg, setSyncMsg] = useState('');
  const [unverified, setUnverified] = useState<Array<{
    id: number;
    originalText: string;
    extractedLocation: string;
    reason: string;
    listing?: Record<string, unknown>;
    attemptedQueries?: string[];
  }>>([]);

  // Persist listings
  useEffect(() => {
    safeLocalStorageSet('ug_persist_v4', JSON.stringify(listings));
  }, [listings]);

  const addOrUpdate = useCallback((newListing: Listing) => {
    const clean = sanitizeListing(newListing as unknown as Record<string, unknown>);
    if (!clean) return;

    setListings(prev => {
      // Check for duplicate
      const dupIdx = prev.findIndex(l =>
        l.areaName === clean.areaName &&
        (l.suburb || '') === (clean.suburb || '') &&
        l.size === clean.size &&
        Math.abs(l.priceUGX - clean.priceUGX) < 10
      );

      if (dupIdx !== -1) {
        const next = [...prev];
        const existing = next[dupIdx];
        next[dupIdx] = {
          ...existing,
          posts: (existing.posts || 1) + 1,
          lat: (clean.lat && clean.lat !== DISTRICT_CENTRES[clean.areaName]?.lat) ? clean.lat : existing.lat,
          lng: (clean.lng && clean.lng !== DISTRICT_CENTRES[clean.areaName]?.lng) ? clean.lng : existing.lng,
          village: clean.village || existing.village,
          suburb: clean.suburb || existing.suburb,
          notes: clean.notes || existing.notes,
        };
        learner.learn(next[dupIdx], computeQualityScore(next[dupIdx]));
        return next;
      } else {
        learner.learn(clean, computeQualityScore(clean));
        return [clean, ...prev];
      }
    });
    setSyncMsg(`Added: ${clean.title}`);
    setTimeout(() => setSyncMsg(''), 3000);
  }, []);

  const deleteOne = useCallback((id: number) => {
    setListings(prev => prev.filter(l => l.id !== id));
    setSelectedId(prev => prev === id ? null : prev);
    setSyncMsg('Deleted');
    setTimeout(() => setSyncMsg(''), 2000);
  }, []);

  const deleteAll = useCallback(() => {
    if (confirm('Delete ALL listings permanently?')) {
      setListings([]);
      setSelectedId(null);
      setSyncMsg('All deleted');
      setTimeout(() => setSyncMsg(''), 2000);
    }
  }, []);

  const selectedListing = listings.find(l => l.id === selectedId);

  const tabs = [
    { id: 'map', label: 'Map', icon: '🗺️' },
    { id: 'records', label: 'Records', icon: '📋' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'valuation', label: 'Valuation', icon: '💰' },
    { id: 'memory', label: 'Memory', icon: '💾' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-semibold text-slate-900 text-sm sm:text-base">
              Uganda Real Estate Map
            </h1>
            <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 hover:bg-green-100">
              AI Learning
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600 flex-wrap">
            <span>{listings.length} listings</span>
            <span>{listings.filter(l => l.status === 'sold').length} sold</span>
            {unverified.length > 0 && (
              <span className="text-amber-600">{unverified.length} unverified</span>
            )}
            {syncMsg && (
              <span className={syncMsg.includes('Deleted') ? 'text-red-500' : 'text-green-600'}>
                {syncMsg}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-[1200px] mx-auto px-4 py-6">
        {tab === 'map' && (
          <div className="space-y-4">
            <MapView
              listings={listings}
              unverifiedLocations={unverified}
              onSelect={(l: Listing) => setSelectedId(l.id)}
            />

            {/* Selected Listing Detail */}
            {selectedListing && (
              <Card className="bg-slate-900 text-white border-0">
                <div className="p-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex gap-2 flex-wrap">
                      <Badge className={`text-[10px] ${
                        selectedListing.status === 'sold'
                          ? 'bg-red-500 hover:bg-red-500'
                          : selectedListing.status === 'unsold'
                          ? 'bg-green-500 hover:bg-green-500'
                          : 'bg-slate-500 hover:bg-slate-500'
                      }`}>
                        {selectedListing.status}
                      </Badge>
                      <Badge className={`text-[10px] ${
                        selectedListing.interest === 'high'
                          ? 'bg-red-400 hover:bg-red-400'
                          : selectedListing.interest === 'medium'
                          ? 'bg-amber-400 hover:bg-amber-400'
                          : 'bg-blue-400 hover:bg-blue-400'
                      }`}>
                        {selectedListing.interest}
                      </Badge>
                      {(selectedListing.posts || 1) > 1 && (
                        <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-400">
                          +{selectedListing.posts} posts
                        </Badge>
                      )}
                      {selectedListing._geocoded && (
                        <Badge className="text-[10px] bg-green-600 hover:bg-green-600">
                          OSM verified
                        </Badge>
                      )}
                    </div>
                    <div className="font-medium text-sm">{selectedListing.title}</div>
                    <div className="text-xs text-slate-400">
                      {selectedListing.size}
                      {selectedListing.agent ? ` · ${selectedListing.agent}` : ''}
                      {selectedListing.village ? ` · ${selectedListing.village}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">UGX {selectedListing.priceUGX}M</div>
                    <button
                      onClick={() => deleteOne(selectedListing.id)}
                      className="text-xs text-red-400 hover:text-red-300 mt-2 px-3 py-1 border border-red-400/50 rounded hover:border-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab === 'records' && (
          <RecordsView
            listings={listings}
            onAddOrUpdate={addOrUpdate}
            onDelete={deleteOne}
            onDeleteAll={deleteAll}
            onSelect={(l: Listing) => setSelectedId(l.id)}
            onSetTab={setTab}
            unverifiedLocations={unverified}
            onSetUnverified={setUnverified}
          />
        )}

        {tab === 'analytics' && (
          <AnalyticsView listings={listings} />
        )}

        {tab === 'valuation' && (
          <ValuationView listings={listings} />
        )}

        {tab === 'memory' && (
          <MemoryView onImport={() => {
            const saved = safeLocalStorageGet('ug_persist_v4');
            if (saved) {
              const parsed = safeJSONParse<unknown[]>(saved, []);
              const cleaned = (Array.isArray(parsed) ? parsed : [])
                .map(item => sanitizeListing(item as Record<string, unknown>))
                .filter(Boolean) as Listing[];
              setListings(cleaned);
            }
          }} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white mt-8">
        <div className="max-w-[1200px] mx-auto px-4 py-4 text-center text-[10px] text-slate-400">
          Self-Learning AI · OSM Geocoding · Pattern Recognition · Memory persists across sessions
        </div>
      </footer>
    </div>
  );
}
