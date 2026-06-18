import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Listing } from '@/types';
import { learner } from '@/lib/learningEngine';

interface AnalyticsViewProps {
  listings: Listing[];
}

export default function AnalyticsView({ listings }: AnalyticsViewProps) {
  const summary = useMemo(() => learner.getSummary(), []);

  const {
    districtStats,
    buckets,
    maxBucket,
    insights,
    totalSold,
    totalUnsold,
    highInterest,
  } = useMemo(() => {
    const stats: Record<string, {
      count: number;
      sold: number;
      totalPrice: number;
      minPrice: number;
      maxPrice: number;
      prices: number[];
      highInt: number;
      villages: Set<string>;
    }> = {};

    listings.forEach(l => {
      if (!l?.areaName) return;
      if (!stats[l.areaName]) {
        stats[l.areaName] = {
          count: 0, sold: 0, totalPrice: 0,
          minPrice: Infinity, maxPrice: 0,
          prices: [], highInt: 0, villages: new Set(),
        };
      }
      const d = stats[l.areaName];
      d.count++;
      if (l.status === 'sold') d.sold++;
      d.totalPrice += l.priceUGX;
      d.minPrice = Math.min(d.minPrice, l.priceUGX);
      d.maxPrice = Math.max(d.maxPrice, l.priceUGX);
      d.prices.push(l.priceUGX);
      if (l.interest === 'high') d.highInt++;
      if (l.village) d.villages.add(l.village);
    });

    const priceBuckets: Record<string, number> = {
      '0-10M': 0, '10-50M': 0, '50-100M': 0, '100-200M': 0, '200M+': 0,
    };
    listings.forEach(l => {
      if (!l) return;
      const p = l.priceUGX;
      if (p < 10) priceBuckets['0-10M']++;
      else if (p < 50) priceBuckets['10-50M']++;
      else if (p < 100) priceBuckets['50-100M']++;
      else if (p < 200) priceBuckets['100-200M']++;
      else priceBuckets['200M+']++;
    });

    const insightsList: string[] = [];
    if (summary.totalListings === 0) {
      insightsList.push('Add property listings to start AI market intelligence');
    } else {
      const topDistricts = Object.entries(stats)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);
      if (topDistricts.length > 0) {
        insightsList.push(`Top districts: ${topDistricts.map(([d, s]) => `${d} (${s.count})`).join(', ')}`);
      }
      const highValue = Object.entries(stats)
        .filter(([_, s]) => s.count > 0)
        .sort((a, b) => (b[1].totalPrice / b[1].count) - (a[1].totalPrice / a[1].count))
        .slice(0, 3);
      if (highValue.length > 0) {
        insightsList.push(`Premium districts: ${highValue.map(([d, s]) => `${d} (avg ${Math.round(s.totalPrice / s.count)}M)`).join(', ')}`);
      }
      insightsList.push(`Overall market average: ${summary.overallAvg > 0 ? `UGX ${summary.overallAvg}M` : 'No data'}`);
      if (summary.patterns > 0) {
        insightsList.push(`${summary.patterns} patterns learned, ${summary.parseRules} parse rules`);
      }
    }

    return {
      districtStats: stats,
      buckets: priceBuckets,
      maxBucket: Math.max(...Object.values(priceBuckets), 1),
      insights: insightsList,
      totalSold: listings.filter(l => l?.status === 'sold').length,
      totalUnsold: listings.filter(l => l?.status === 'unsold').length,
      highInterest: listings.filter(l => l?.interest === 'high').length,
    };
  }, [listings, summary]);

  const priceBarColors: Record<string, string> = {
    '0-10M': '#3b82f6',
    '10-50M': '#8b5cf6',
    '50-100M': '#f59e0b',
    '100-200M': '#ef4444',
    '200M+': '#991b1b',
  };

  return (
    <div className="space-y-4">
      {/* AI Market Intelligence */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">AI Market Intelligence</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs font-medium mb-3">
            {summary.totalListings} listings across {summary.districts} districts
          </p>
          <div className="flex gap-3 flex-wrap mb-4">
            <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
              {totalSold} sold
            </Badge>
            <Badge variant="outline" className="bg-amber-50 text-amber-700 text-xs">
              {totalUnsold} unsold
            </Badge>
            <Badge variant="outline" className="bg-red-50 text-red-700 text-xs">
              {highInterest} high interest
            </Badge>
          </div>
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <li key={i} className="text-xs text-slate-600 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-slate-400">
                {ins}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* District Analytics */}
      {Object.keys(districtStats).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">District Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(districtStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([district, stats]) => {
                  const avg = stats.count ? Math.round(stats.totalPrice / stats.count) : 0;
                  const soldRate = stats.count ? Math.round((stats.sold / stats.count) * 100) : 0;
                  return (
                    <div key={district} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <h4 className="text-xs font-semibold mb-2">{district}</h4>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Listings</span>
                          <span className="font-medium">{stats.count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Avg Price</span>
                          <span className="font-medium text-green-700">UGX {avg}M</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Range</span>
                          <span>{stats.minPrice === Infinity ? '-' : stats.minPrice}M - {stats.maxPrice}M</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Sold</span>
                          <span>{soldRate}% ({stats.sold})</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Villages</span>
                          <span>{stats.villages.size}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-slate-200 rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (avg / 200) * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Price Distribution */}
      {Object.keys(buckets).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Price Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(buckets).map(([range, count]) => {
              const pct = Math.round((count / maxBucket) * 100);
              return (
                <div key={range}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{range}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: priceBarColors[range] || '#3b82f6' }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Learning Engine Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Self-Learning Engine Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              ['Listings', summary.totalListings],
              ['Districts', summary.districts],
              ['Patterns', summary.patterns],
              ['Quality', `${summary.qualityScore}%`],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-lg font-bold">{v}</div>
                <div className="text-[10px] text-slate-500">{k}</div>
              </div>
            ))}
          </div>
          {summary.parseRules > 0 && (
            <p className="text-xs text-slate-500 mt-3">
              {summary.parseRules} parse rules learned from patterns
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
