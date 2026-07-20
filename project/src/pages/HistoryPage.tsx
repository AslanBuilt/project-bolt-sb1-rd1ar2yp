import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getSignedUrls } from '../lib/storage';
import { Outfit, ClothingItem } from '../types';
import { Calendar, Check, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

export function HistoryPage() {
  const { user } = useAuth();
  const [outfits, setOutfits] = useState<(Outfit & { items?: ClothingItem[] })[]>([]);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  useEffect(() => {
    if (user) {
      fetchOutfits();
    }
  }, [user, selectedMonth]);

  // Fetch signed URLs when outfits change
  useEffect(() => {
    if (outfits.length > 0) {
      const allPaths: string[] = [];
      outfits.forEach(outfit => {
        outfit.items?.forEach(item => {
          if (item.photo_url) allPaths.push(item.photo_url);
        });
      });
      if (allPaths.length > 0) {
        getSignedUrls(allPaths).then(urlMap => {
          setSignedUrls(urlMap);
        });
      }
    }
  }, [outfits]);

  const fetchOutfits = async () => {
    setLoading(true);

    const startOfMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    const endOfMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0);

    const { data, error } = await supabase
      .from('outfits')
      .select('*')
      .eq('worn', true)
      .gte('date', startOfMonth.toLocaleDateString('en-CA'))
      .lte('date', endOfMonth.toLocaleDateString('en-CA'))
      .order('date', { ascending: false });

    if (!error && data) {
      // Fetch items for each outfit
      const outfitsWithItems = await Promise.all(
        data.map(async (outfit) => {
          const { data: items } = await supabase
            .from('clothing_items')
            .select('*')
            .in('id', outfit.item_ids || []);
          return { ...outfit, items: items || [] };
        })
      );
      setOutfits(outfitsWithItems);
    }

    setLoading(false);
  };

  const getPhotoUrl = (item: ClothingItem): string => {
    return signedUrls.get(item.photo_url) || item.photo_url;
  };

  const deleteOutfit = async (id: string) => {
    const { error } = await supabase.from('outfits').delete().eq('id', id);
    if (!error) setOutfits((prev) => prev.filter((o) => o.id !== id));
  };

  const navigateMonth = (direction: number) => {
    const newMonth = new Date(selectedMonth);
    newMonth.setMonth(newMonth.getMonth() + direction);
    setSelectedMonth(newMonth);
  };

  const monthName = selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-6">
      <h2 className="text-xl font-semibold text-slate-900 mb-4">Outfit History</h2>

      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigateMonth(-1)}
          className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h3 className="font-medium text-slate-900">{monthName}</h3>
        <button
          onClick={() => navigateMonth(1)}
          className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-50"
        >
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </button>
      </div>

      {outfits.length === 0 ? (
        <div className="text-center py-12">
          <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 mb-2">No outfits worn this month</p>
          <p className="text-sm text-slate-400">When you wear an outfit, it'll appear here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {outfits.map((outfit) => (
            <div key={outfit.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3 justify-between">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                  <Check className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">
                    {(() => {
                      const [y, m, d] = outfit.date.split('-').map(Number);
                      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      });
                    })()}
                  </p>
                  {outfit.activity_text && (
                    <p className="text-sm text-slate-500">{outfit.activity_text}</p>
                  )}
                </div>
                <button onClick={() => deleteOutfit(outfit.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4" /></button>
              </div>

              {outfit.items && outfit.items.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {outfit.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex-shrink-0 w-20 aspect-[3/4] rounded-lg overflow-hidden bg-slate-100"
                    >
                      <img
                        src={getPhotoUrl(item)}
                        alt={item.subcategory}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
