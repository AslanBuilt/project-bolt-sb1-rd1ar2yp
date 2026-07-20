import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getSignedUrls } from '../lib/storage';
import { ClothingItem, ClothingCategory } from '../types';
import { Heart, X, Edit2, Trash2, AlertCircle } from 'lucide-react';

const CATEGORIES: { value: ClothingCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'shirts', label: 'Shirts' },
  { value: 'sweatshirt_jacket', label: 'Sweatshirt/Jackets' },
  { value: 'pants', label: 'Pants' },
  { value: 'shorts', label: 'Shorts' },
  { value: 'shoes', label: 'Shoes' },
];

export function ClosetPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [categoryId, setCategoryId] = useState<ClothingCategory | 'all'>('all');
  const [showFavorites, setShowFavorites] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ClothingItem | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (user) {
      fetchItems();
    }
  }, [user, showRetired]);

  // Fetch signed URLs whenever items change
  useEffect(() => {
    if (items.length > 0) {
      const paths = items.map(item => item.photo_url).filter(Boolean);
      getSignedUrls(paths).then(urlMap => {
        setSignedUrls(urlMap);
      });
    }
  }, [items]);

  const fetchItems = async () => {
    setLoading(true);
    let query = supabase
      .from('clothing_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (!showRetired) {
      query = query.eq('retired', false);
    }

    const { data, error } = await query;
    if (!error && data) {
      setItems(data);
    }
    setLoading(false);
  };

  const getPhotoUrl = (item: ClothingItem): string => {
    return signedUrls.get(item.photo_url) || item.photo_url;
  };

  const toggleFavorite = async (item: ClothingItem) => {
    await supabase
      .from('clothing_items')
      .update({ favorite: !item.favorite })
      .eq('id', item.id);

    setItems(items.map(i =>
      i.id === item.id ? { ...i, favorite: !i.favorite } : i
    ));
  };

  const toggleRetired = async (item: ClothingItem) => {
    await supabase
      .from('clothing_items')
      .update({ retired: !item.retired })
      .eq('id', item.id);

    if (!showRetired) {
      setItems(items.filter(i => i.id !== item.id));
    } else {
      setItems(items.map(i =>
        i.id === item.id ? { ...i, retired: !i.retired } : i
      ));
    }
    setSelectedItem(null);
  };

  const deleteItem = async (item: ClothingItem) => {
    await supabase.from('clothing_items').delete().eq('id', item.id);
    setItems(items.filter(i => i.id !== item.id));
    setSelectedItem(null);
    setConfirmingDelete(false);
  };

  const filteredItems = items.filter(item => {
    if (categoryId !== 'all' && item.category !== categoryId) return false;
    if (showFavorites && !item.favorite) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-900">My Closet</h2>
        <button
          onClick={() => setShowRetired(!showRetired)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
            showRetired
              ? 'bg-slate-800 border-slate-800 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
          }`}
        >
          {showRetired ? 'Hide Retired' : 'Show Retired'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 -mx-4 px-4">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategoryId(cat.value)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              categoryId === cat.value
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:border-emerald-400'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Favorites toggle */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setShowFavorites(!showFavorites)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            showFavorites
              ? 'bg-rose-100 text-rose-600'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Heart className={`w-4 h-4 ${showFavorites ? 'fill-current' : ''}`} />
          Favorites only
        </button>
      </div>

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-500 mb-2">No items found</p>
          <p className="text-sm text-slate-400">
            {items.length === 0
              ? 'Start by adding some clothes!'
              : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 group cursor-pointer ${
                item.ai_uncertain_fields && item.ai_uncertain_fields.length > 0 ? 'ring-2 ring-amber-400 ring-offset-1' : ''
              }`
              }
              onClick={() => setSelectedItem(item)}
            >
              <img
                src={getPhotoUrl(item)}
                alt={item.subcategory}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-white text-sm font-medium truncate">{item.subcategory}</p>
                <p className="text-white/80 text-xs capitalize">{item.primary_color} | {item.category}</p>
              </div>
              {item.favorite && (
                <div className="absolute top-2 right-2 w-6 h-6 bg-rose-500 rounded-full flex items-center justify-center">
                  <Heart className="w-3 h-3 text-white fill-current" />
                </div>
              )}
              {item.ai_uncertain_fields && item.ai_uncertain_fields.length > 0 && (
                <div className="absolute top-2 left-2 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center shadow-sm">
                  <AlertCircle className="w-3 h-3 text-white" />
                </div>
              )}
              {item.retired && (
                <div className="absolute top-3 left-8 px-2 py-0.5 bg-slate-700 rounded text-xs text-white font-medium">
                  Retired
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center" onClick={() => { setSelectedItem(null); setConfirmingDelete(false); }}>
          <div
            className="bg-white rounded-t-3xl w-full max-w-lg max-h-[85vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto flex-1 min-h-0">
              <div className="aspect-[3/4] w-full max-h-[45vh] bg-slate-100">
                <img
                  src={getPhotoUrl(selectedItem)}
                  alt={selectedItem.subcategory}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 capitalize">{selectedItem.subcategory}</h3>
                    <p className="text-sm text-slate-500">
                      {selectedItem.primary_color}
                      {selectedItem.secondary_color && ` & ${selectedItem.secondary_color}`} | {selectedItem.pattern}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleFavorite(selectedItem)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      selectedItem.favorite ? 'bg-rose-100 text-rose-500' : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${selectedItem.favorite ? 'fill-current' : ''}`} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">Formality</p>
                    <p className="text-sm font-medium text-slate-900 capitalize">{selectedItem.formality}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">Season</p>
                    <p className="text-sm font-medium text-slate-900 capitalize">{selectedItem.season}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">Times worn</p>
                    <p className="text-sm font-medium text-slate-900">{selectedItem.times_worn}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-1">Added</p>
                    <p className="text-sm font-medium text-slate-900">
                      {new Date(selectedItem.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 p-4 border-t border-slate-100 flex-shrink-0">
                <button
                  onClick={() => confirmingDelete ? setConfirmingDelete(false) : toggleRetired(selectedItem)}
                  className={confirmingDelete ? 'flex-1 py-2.5 rounded-lg font-medium text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors' : (selectedItem.retired ? 'flex-1 py-2.5 rounded-lg font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors' : 'flex-1 py-2.5 rounded-lg font-medium text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors')}
                >
                  {confirmingDelete ? 'Cancel' : selectedItem.retired ? 'Restore Item' : 'Retire Item'}
                </button>
                <button
                  onClick={() => confirmingDelete ? deleteItem(selectedItem) : setConfirmingDelete(true)}
                  className={confirmingDelete ? 'flex-1 py-2.5 rounded-lg font-medium text-sm bg-red-600 text-white hover:bg-red-700 transition-colors' : 'w-12 h-10 flex items-center justify-center bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors'}
                >
                  {confirmingDelete ? 'Delete Item' : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
