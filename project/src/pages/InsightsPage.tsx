import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getSignedUrls } from '../lib/storage';
import { ClothingItem, ClothingCategory } from '../types';
import { ChevronLeft, Shirt, TrendingUp, TrendingDown, Sparkles, Archive } from 'lucide-react';

const CATEGORY_LABELS: Record<ClothingCategory, string> = {
  shirts: 'Shirts',
  sweatshirt_jacket: 'Sweatshirt/Jackets',
  pants: 'Pants',
  shorts: 'Shorts',
  shoes: 'Shoes',
};

const THRESHOLD_OPTIONS = [14, 30, 60, 90];

export function InsightsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(30);

  useEffect(() => {
    if (user) fetchItems();
  }, [user]);

  const fetchItems = async () => {
    setLoading(true);
    // Archived ("retired") items are excluded from stats, same as they're
    // already excluded from the closet grid default view and recommendations.
    const { data } = await supabase
      .from('clothing_items')
      .select('*')
      .eq('retired', false);

    if (data) {
      setItems(data);
      const paths = data.map(i => i.photo_url).filter(Boolean);
      getSignedUrls(paths).then(setSignedUrls);
    }
    setLoading(false);
  };

  const getPhotoUrl = (item: ClothingItem): string => signedUrls.get(item.photo_url) || item.photo_url;

  const stats = useMemo(() => {
    const byCategory: Record<string, number> = {};
    const byColor: Record<string, number> = {};

    for (const item of items) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      byColor[item.primary_color] = (byColor[item.primary_color] || 0) + 1;
    }

    const sortedByWorn = [...items].sort((a, b) => b.times_worn - a.times_worn);
    const mostWorn = sortedByWorn.slice(0, 5);
    const leastWorn = [...sortedByWorn].reverse().slice(0, 5);

    const wornAtLeastOnce = items.filter(i => i.times_worn > 0).length;
    const percentWorn = items.length > 0 ? Math.round((wornAtLeastOnce / items.length) * 100) : 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - threshold);
    const notWornRecently = items
      .filter(i => !i.last_worn_date || new Date(i.last_worn_date) < cutoff)
      .sort((a, b) => {
        if (!a.last_worn_date && !b.last_worn_date) return 0;
        if (!a.last_worn_date) return -1;
        if (!b.last_worn_date) return 1;
        return new Date(a.last_worn_date).getTime() - new Date(b.last_worn_date).getTime();
      });

    return {
      total: items.length,
      byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
      byColor: Object.entries(byColor).sort((a, b) => b[1] - a[1]),
      mostWorn,
      leastWorn,
      percentWorn,
      notWornRecently,
    };
  }, [items, threshold]);

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/settings')}
          className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-semibold text-slate-900">Closet Insights</h2>
      </div>

      {stats.total === 0 ? (
        <div className="text-center py-12">
          <Shirt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">Add some items to your closet to see insights</p>
        </div>
      ) : (
        <>
          {/* Headline stat - Spotify Wrapped style */}
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 mb-4 text-white">
            <div className="flex items-center gap-1.5 mb-1 opacity-90">
              <Sparkles className="w-4 h-4" />
              <p className="text-xs font-medium uppercase tracking-wide">Your closet, worn</p>
            </div>
            <p className="text-4xl font-bold mb-1">{stats.percentWorn}%</p>
            <p className="text-sm opacity-90">
              of your {stats.total}-item closet has been worn at least once
            </p>
          </div>

          {/* Category + color breakdown */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700 mb-2">By category</p>
              <div className="space-y-1.5">
                {stats.byCategory.map(([cat, count]) => (
                  <div key={cat} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{CATEGORY_LABELS[cat as ClothingCategory] || cat}</span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700 mb-2">By color</p>
              <div className="space-y-1.5">
                {stats.byColor.slice(0, 6).map(([color, count]) => (
                  <div key={color} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 capitalize">{color}</span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Most / least worn */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-medium text-slate-700">Most worn</p>
              </div>
              <div className="space-y-2">
                {stats.mostWorn.map(item => (
                  <div key={item.id} className="flex items-center gap-2">
                    <img src={getPhotoUrl(item)} alt={item.subcategory} className="w-8 h-8 rounded-md object-cover bg-slate-100 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 truncate capitalize">{item.primary_color} {item.subcategory}</p>
                      <p className="text-xs text-slate-400">{item.times_worn}x</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingDown className="w-4 h-4 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">Least worn</p>
              </div>
              <div className="space-y-2">
                {stats.leastWorn.map(item => (
                  <div key={item.id} className="flex items-center gap-2">
                    <img src={getPhotoUrl(item)} alt={item.subcategory} className="w-8 h-8 rounded-md object-cover bg-slate-100 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 truncate capitalize">{item.primary_color} {item.subcategory}</p>
                      <p className="text-xs text-slate-400">{item.times_worn}x</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Not worn recently */}
          <div id="not-worn" className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-medium text-slate-900">Haven't worn lately</h3>
              <select
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1"
              >
                {THRESHOLD_OPTIONS.map(days => (
                  <option key={days} value={days}>{days}+ days</option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              {stats.notWornRecently.length === 0
                ? "Nothing's been sitting unused - nice rotation!"
                : `${stats.notWornRecently.length} ${stats.notWornRecently.length === 1 ? 'item hasn\'t' : 'items haven\'t'} been worn in ${threshold}+ days. No pressure - just something to consider next time you're deciding what to keep.`}
            </p>

            {stats.notWornRecently.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {stats.notWornRecently.map(item => (
                  <div key={item.id} className="relative">
                    <img
                      src={getPhotoUrl(item)}
                      alt={item.subcategory}
                      className="w-full aspect-[3/4] rounded-lg object-cover bg-slate-100"
                    />
                    <p className="text-xs text-slate-500 mt-1 truncate capitalize">{item.primary_color} {item.subcategory}</p>
                    <p className="text-xs text-slate-400">
                      {item.last_worn_date ? `Last worn ${new Date(item.last_worn_date).toLocaleDateString()}` : 'Never worn'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {stats.notWornRecently.length > 0 && (
              <button
                onClick={() => navigate('/closet')}
                className="w-full flex items-center justify-center gap-1.5 mt-3 bg-slate-50 hover:bg-slate-100 text-slate-600 text-sm font-medium py-2 rounded-lg transition-colors"
              >
                <Archive className="w-3.5 h-3.5" />
                Go to Closet to archive or review
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
