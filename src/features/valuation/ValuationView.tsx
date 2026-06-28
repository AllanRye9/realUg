import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Listing } from '@/types';
import { ALL_DISTRICTS, WEIGHTS } from '@/lib/ugandaData';
import { parseSize } from '@/lib/parser';

interface ValuationViewProps {
  listings: Listing[];
}

export default function ValuationView({ listings }: ValuationViewProps) {
  const [area, setArea] = useState('Kampala Central');
  const [sizeInput, setSizeInput] = useState('450');
  const [tier, setTier] = useState('standard');

  // Parse size input (handles "30x30", "1 acre", "500 sqm", etc.)
  const sizeSqm = useMemo(() => {
    const input = String(sizeInput || '').toLowerCase().trim();
    if (!input) return 0;

    // Try dimensions: 30x30, 30 by 30, 30 * 30
    const dimMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:x|by|\*|×)\s*(\d+(?:\.\d+)?)/);
    if (dimMatch) {
      const w = parseFloat(dimMatch[1]);
      const h = parseFloat(dimMatch[2]);
      if (!isNaN(w) && !isNaN(h)) return w * h;
    }

    // Try acres: 1 acre, 0.5 acres, half acre
    const acreMatch = input.match(/(\d+(?:\.\d+)?)\s*acres?/);
    if (acreMatch) {
      const acres = parseFloat(acreMatch[1]);
      if (!isNaN(acres)) return acres * 4046.86;
    }
    const halfAcreMatch = input.match(/(half|0\.5)\s*(?:an?\s*)?acres?/);
    if (halfAcreMatch) return 2023;

    // Try hectares
    const haMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:ha|hectares?)/);
    if (haMatch) {
      const ha = parseFloat(haMatch[1]);
      if (!isNaN(ha)) return ha * 10000;
    }

    // Try decimals
    const decMatch = input.match(/(\d+(?:\.\d+)?)\s*decimals?/);
    if (decMatch) {
      const dec = parseFloat(decMatch[1]);
      if (!isNaN(dec)) return dec * 404.686;
    }

    // Direct sqm number
    const direct = parseFloat(input);
    if (!isNaN(direct) && direct > 0) return direct;

    return 0;
  }, [sizeInput]);

  const pricePerSqmByArea = useMemo(() => {
    const rates: Record<string, { ppm: number; count: number }> = {};
    for (const d of ALL_DISTRICTS) rates[d] = { ppm: 0, count: 0 };

    listings.forEach(l => {
      if (!l) return;
      const sq = parseSize(l.size).sizeSqm;
      if (sq && sq > 0 && l.priceUGX > 0) {
        const ppm = l.priceUGX / sq;
        if (ppm > 0 && ppm < 10) {
          rates[l.areaName].ppm += ppm;
          rates[l.areaName].count++;
        }
      }
    });

    for (const d of ALL_DISTRICTS) {
      if (rates[d].count) rates[d].ppm /= rates[d].count;
      else rates[d].ppm = (WEIGHTS[d] || 0.5) * 0.35;
    }
    return rates;
  }, [listings]);

  const estimate = useMemo(() => {
    if (!sizeSqm || isNaN(sizeSqm) || sizeSqm <= 0) return null;
    const base = pricePerSqmByArea[area]?.ppm || 0.35;
    const multiplier = tier === 'prime' ? 1.25 : tier === 'secondary' ? 0.85 : 1;
    return {
      est: Math.round(sizeSqm * base * multiplier),
      baseRate: base,
      comps: pricePerSqmByArea[area]?.count || 0,
    };
  }, [area, sizeSqm, tier, pricePerSqmByArea]);

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Market Valuation Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Enter property size (e.g., &quot;30x30&quot;, &quot;1 acre&quot;, &quot;500 sqm&quot;, &quot;2.5 ha&quot;) to get an estimated market value based on learned price patterns.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">District</label>
            <select
              value={area}
              onChange={e => setArea(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white outline-none focus:border-slate-400"
            >
              {ALL_DISTRICTS.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Size</label>
            <Input
              value={sizeInput}
              onChange={e => setSizeInput(e.target.value)}
              placeholder="e.g. 30x30, 1 acre, 500 sqm"
              className="text-xs"
            />
            {sizeSqm > 0 && (
              <p className="text-[10px] text-slate-500 mt-1">
                = {Math.round(sizeSqm).toLocaleString()} m²
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 mb-1 block">Tier</label>
            <div className="flex gap-2">
              {[
                { value: 'standard', label: 'Standard', desc: 'Base rate' },
                { value: 'prime', label: 'Prime (+25%)', desc: 'Best locations' },
                { value: 'secondary', label: 'Secondary (-15%)', desc: 'Developing areas' },
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => setTier(t.value)}
                  className={`flex-1 p-2 rounded-lg border text-xs transition-colors ${
                    tier === t.value
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className={`text-[10px] ${tier === t.value ? 'text-slate-300' : 'text-slate-400'}`}>
                    {t.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {estimate && (
          <div className="bg-slate-50 rounded-lg p-4 text-center">
            <div className="text-xs text-slate-500 mb-1">Estimated Value</div>
            <div className="text-3xl font-bold text-slate-900">
              UGX {estimate.est.toLocaleString()}M
            </div>
            <div className="text-[10px] text-slate-500 mt-2">
              Based on {estimate.comps} comparable sales &middot; {estimate.baseRate.toFixed(2)}M per m²
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {area} &middot; {tier} tier &middot; {Math.round(sizeSqm)}m²
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
