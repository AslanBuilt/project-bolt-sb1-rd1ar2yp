import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getSignedUrl, getSignedUrls } from '../lib/storage';
import { ClothingItem, Outfit } from '../types';
import {
  filterAndScoreItems,
  generateOutfitCandidates,
  calculateColorScore,
  getCurrentSeason,
  detectFormality,
  getActivityHints,
} from '../lib/recommendations';
import { getCurrentWeather, getWeatherRecommendation, WeatherData } from '../lib/weather';
import {
  Sparkles,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  CloudSun,
  Thermometer,
  Info,
  Wand2,
  Repeat,
} from 'lucide-react';

interface GeneratedOutfit {
  id: string;
  items: ClothingItem[];
  reason: string;
  colorScore: number;
  source: 'rule-based' | 'ai';
}

export function TodayPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ClothingItem[]>([]);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activity, setActivity] = useState('');
  const [outfits, setOutfits] = useState<GeneratedOutfit[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [savedOutfit, setSavedOutfit] = useState<(Outfit & { items?: ClothingItem[] }) | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherHints, setWeatherHints] = useState<string[]>([]);
  const [aiSource, setAiSource] = useState<'idle' | 'ai' | 'rule-based'>('idle');
  const [pastOutfitCombos, setPastOutfitCombos] = useState<Map<string, { timesWorn: number; lastWorn: string }>>(new Map());
  const [suggestedRatings, setSuggestedRatings] = useState<Map<string, 'up' | 'down'>>(new Map());
  const [basePhotoUrl, setBasePhotoUrl] = useState<string | null>(null);
  const [tryOnResults, setTryOnResults] = useState<Map<string, { status: 'generating' | 'done' | 'failed'; imageUrl?: string }>>(new Map());

  useEffect(() => {
    if (user) {
      fetchData();
      fetchWeather();
    }
  }, [user]);

  // Fetch signed URLs when items change
  useEffect(() => {
    if (items.length > 0) {
      const paths = items.map(item => item.photo_url).filter(Boolean);
      getSignedUrls(paths).then(urlMap => {
        setSignedUrls(urlMap);
      });
    }
  }, [items]);

  const getPhotoUrl = (item: ClothingItem): string => {
    return signedUrls.get(item.photo_url) || item.photo_url;
  };

  const fetchData = async () => {
    setLoading(true);

    const [itemsResult, todayOutfitsResult, prefsResult] = await Promise.all([
      supabase
        .from('clothing_items')
        .select('*')
        .eq('retired', false)
        .order('last_worn_date', { ascending: true, nullsFirst: true }),
      supabase
        .from('outfits')
        .select('*')
        .eq('date', new Date().toISOString().split('T')[0])
        .eq('worn', true)
        .order('created_at', { ascending: false })
        .limit(1),
      supabase.from('style_preferences').select('base_photo_url').eq('user_id', user!.id).maybeSingle(),
    ]);

    if (itemsResult.data) setItems(itemsResult.data);
    if (prefsResult.data?.base_photo_url) {
      const signedUrl = await getSignedUrl(prefsResult.data.base_photo_url);
      setBasePhotoUrl(signedUrl);
    }

    // Fetch all past worn outfits to build combo lookup
    const { data: allOutfits } = await supabase
      .from('outfits')
      .select('item_ids, date, worn')
      .eq('worn', true)
      .order('date', { ascending: false });

    if (allOutfits) {
      const comboMap = new Map<string, { timesWorn: number; lastWorn: string }>();
      for (const o of allOutfits) {
        const key = (o.item_ids || []).slice().sort().join('-');
        if (!key) continue;
        const existing = comboMap.get(key);
        if (existing) {
          existing.timesWorn += 1;
        } else {
          comboMap.set(key, { timesWorn: 1, lastWorn: o.date });
        }
      }
      setPastOutfitCombos(comboMap);
    }

    // Fetch existing ratings for combos (not just worn outfits)
    const { data: ratedOutfits } = await supabase
      .from('outfits')
      .select('item_ids, rating')
      .not('rating', 'is', null)
      .order('created_at', { ascending: false });

    if (ratedOutfits) {
      const ratingMap = new Map<string, 'up' | 'down'>();
      for (const o of ratedOutfits) {
        const key = (o.item_ids || []).slice().sort().join('-');
        if (key && o.rating) {
          // Keep the most recent rating (first one encountered since sorted desc)
          if (!ratingMap.has(key)) {
            ratingMap.set(key, o.rating as 'up' | 'down');
          }
        }
      }
      setSuggestedRatings(ratingMap);
    }

    if (todayOutfitsResult.data && todayOutfitsResult.data.length > 0) {
      const outfit = todayOutfitsResult.data[0];
      const { data: outfitItems } = await supabase
        .from('clothing_items')
        .select('*')
        .in('id', outfit.item_ids || []);
      setSavedOutfit({ ...outfit, items: outfitItems || [] });
    }

    setLoading(false);
  };

  const fetchWeather = async () => {
    setWeatherLoading(true);
    const w = await getCurrentWeather();
    setWeather(w);
    setWeatherHints(getWeatherRecommendation(w));
    setWeatherLoading(false);
  };

  const generateOutfits = async () => {
    if (items.length < 3) {
      alert('Add at least 3 items to your closet first!');
      return;
    }

    setGenerating(true);
    setOutfits([]);
    setCurrentIndex(0);
    setAiSource('idle');

    const season = getCurrentSeason();
    const formality = detectFormality(activity);
    const activityHints = getActivityHints(activity);

    // Get recently worn item IDs (last 5 days)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const recentlyWorn = items.filter(
      item => item.last_worn_date && new Date(item.last_worn_date) > fiveDaysAgo
    );
    const recentlyWornIds = recentlyWorn.map(i => i.id);

    // Fetch past outfit ratings
    const { data: pastOutfits } = await supabase
      .from('outfits')
      .select('item_ids, activity_text, rating, created_at')
      .eq('worn', true)
      .not('rating', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    const pastRatings: { item_id: string; rating: 'up' | 'down' }[] = [];
    for (const outfit of pastOutfits || []) {
      for (const itemId of outfit.item_ids || []) {
        const existing = pastRatings.find(r => r.item_id === itemId);
        if (!existing && outfit.rating) {
          pastRatings.push({ item_id: itemId, rating: outfit.rating as 'up' | 'down' });
        }
      }
    }

    // Filter items for weather/activity
    let eligibleItems = [...items];
    if (weather?.isHot) {
      eligibleItems = eligibleItems.filter(i => !(i.category === 'sweatshirt_jacket' && i.subcategory === 'coat'));
    }
    if (activityHints.preferComfort) {
      eligibleItems = eligibleItems.filter(i => i.formality === 'casual' || i.formality === 'smart-casual');
    }

    // ---- Pass 1: Rule-based (show immediately) ----
    const scores = filterAndScoreItems({
      items: eligibleItems,
      formality,
      season,
      recentlyWornIds,
      pastRatings,
    });

    const ruleCandidates = generateOutfitCandidates(
      scores,
      { items: eligibleItems, formality, season, recentlyWornIds, pastRatings }
    );

    const ruleOutfits: GeneratedOutfit[] = ruleCandidates.map(outfitItems => {
      const colorScore = calculateColorScore(outfitItems);
      const mainItem = outfitItems[0];
      const secondItem = outfitItems[1];

      let reason = '';
      if (activity) {
        reason = `Matches your ${formality} vibe for "${activity}" — `;
      } else {
        reason = `A polished ${formality} look — `;
      }
      reason += `${mainItem.primary_color} ${mainItem.subcategory} with ${secondItem.primary_color} ${secondItem.subcategory}`;
      if (colorScore > 80) reason += '. Great color coordination.';
      else if (weather?.isCold) reason += '. Good for layering today.';

      return { id: crypto.randomUUID(), items: outfitItems, reason, colorScore, source: 'rule-based' };
    });

    setOutfits(ruleOutfits);
    setAiSource('rule-based');

    // ---- Pass 2: AI (Gemini) enhancement ----
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) throw new Error('Missing config');

      const { data: prefs } = await supabase
        .from('style_preferences')
        .select('style_tags, formality_range_min, formality_range_max')
        .eq('user_id', user!.id)
        .maybeSingle();

      // Fetch aggregated inspiration profile
      const { data: inspirationData } = await supabase
        .from('inspiration_images')
        .select('color_palette, silhouette, pattern_trends')
        .eq('analyzed', true)
        .eq('confirmed', true);

      const inspirationProfile = inspirationData && inspirationData.length > 0
        ? {
            colorPalette: inspirationData.flatMap((d: { color_palette: string[] }) => d.color_palette || []),
            silhouettes: inspirationData.map((d: { silhouette: string }) => d.silhouette).filter(Boolean),
            patternTrends: inspirationData.flatMap((d: { pattern_trends: string[] }) => d.pattern_trends || []),
          }
        : null;

      // Fetch rated outfit history for the recommendation engine
      const { data: ratedOutfits } = await supabase
        .from('outfits')
        .select('item_ids, rating')
        .not('rating', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      // Build liked/disliked combo summaries using item details
      const itemMap = new Map(eligibleItems.map(i => [i.id, i]));
      const buildComboSummary = (outfit: { item_ids: string[] }) => {
        const comboItems = (outfit.item_ids || [])
          .map(id => itemMap.get(id))
          .filter(Boolean) as typeof eligibleItems;
        if (comboItems.length === 0) return null;
        return comboItems.map(i => `${i.primary_color} ${i.subcategory}`).join(' + ');
      };

      const likedCombos: string[] = [];
      const dislikedCombos: string[] = [];
      const seenCombos = new Set<string>();
      for (const o of ratedOutfits || []) {
        const key = (o.item_ids || []).slice().sort().join('-');
        if (seenCombos.has(key)) continue;
        seenCombos.add(key);
        const summary = buildComboSummary(o);
        if (!summary) continue;
        if (o.rating === 'up' && likedCombos.length < 10) likedCombos.push(summary);
        else if (o.rating === 'down' && dislikedCombos.length < 10) dislikedCombos.push(summary);
      }

      const ratingHistory = {
        liked: likedCombos,
        disliked: dislikedCombos,
      };

      // Send all eligible items (rule engine has already filtered by weather/season)
      const response = await fetch(`${supabaseUrl}/functions/v1/outfit-recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          items: eligibleItems.map(i => ({
            id: i.id,
            category: i.category,
            subcategory: i.subcategory,
            primary_color: i.primary_color,
            secondary_color: i.secondary_color,
            pattern: i.pattern,
            formality: i.formality,
            season: i.season,
          })),
          activityText: activity,
          preferences: prefs,
          weather: weather ? { temp: weather.temp, condition: weather.condition } : null,
          inspirationProfile,
          ratingHistory,
        }),
      });

      if (response.ok) {
        const result = await response.json();

        if (result.recommendations?.length > 0) {
          const itemMap = new Map(items.map(i => [i.id, i]));

          const aiOutfits: GeneratedOutfit[] = result.recommendations
            .map((rec: { itemIds?: string[]; reason?: string }) => {
              const fullItems = (rec.itemIds || [])
                .map((id: string) => itemMap.get(id))
                .filter(Boolean) as ClothingItem[];
              if (fullItems.length < 2) return null;
              return {
                id: crypto.randomUUID(),
                items: fullItems,
                reason: rec.reason || `AI-curated ${formality} outfit`,
                colorScore: calculateColorScore(fullItems),
                source: 'ai' as const,
              };
            })
            .filter(Boolean) as GeneratedOutfit[];

          if (aiOutfits.length > 0) {
            setOutfits(aiOutfits);
            setAiSource(result.source === 'ai' ? 'ai' : 'rule-based');
          }
        }
      }
    } catch (e) {
      console.log('AI pass skipped, using rule-based results');
    }

    setGenerating(false);
  };

  // CatVTON/IDM-VTON take one garment per body region per call. If both a
  // base layer (shirts) and an outer layer (sweatshirt_jacket) are present,
  // only the visible outer layer is sent for the "upper" step. Shoes/accessories
  // are never included - neither model supports those categories.
  const getTryOnStepItems = (outfitItems: ClothingItem[]): ClothingItem[] => {
    const upperItem =
      outfitItems.find(i => i.category === 'sweatshirt_jacket') ||
      outfitItems.find(i => i.category === 'shirts');
    const lowerItem = outfitItems.find(i => i.category === 'pants' || i.category === 'shorts');
    return [upperItem, lowerItem].filter((i): i is ClothingItem => Boolean(i));
  };

  const getComboKey = (stepItems: ClothingItem[]): string => stepItems.map(i => i.id).sort().join('-');

  // Starts (or resumes watching) background generation for a specific item
  // combination, keyed independent of any outfits row - so it can begin the
  // moment a candidate is shown, before the user has committed to wearing it.
  const ensureTryOn = async (outfitItems: ClothingItem[]) => {
    if (!user || !basePhotoUrl) return;

    const stepItems = getTryOnStepItems(outfitItems);
    if (stepItems.length === 0) return;
    const comboKey = getComboKey(stepItems);

    const existingLocal = tryOnResults.get(comboKey);
    if (existingLocal?.status === 'generating' || existingLocal?.status === 'done') return;

    const { data: existingRow } = await supabase
      .from('tryon_results')
      .select('status, image_url, updated_at')
      .eq('user_id', user.id)
      .eq('combo_key', comboKey)
      .maybeSingle();

    const isStale = existingRow?.status === 'generating' &&
      Date.now() - new Date(existingRow.updated_at).getTime() > 2 * 60 * 1000;

    if (existingRow && existingRow.status !== 'failed' && !isStale) {
      if (existingRow.status === 'done' && existingRow.image_url) {
        const signedUrl = await getSignedUrl(existingRow.image_url);
        setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'done', imageUrl: signedUrl }));
      } else {
        setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'generating' }));
      }
      return;
    }

    setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'generating' }));
    await supabase.from('tryon_results').upsert({
      user_id: user.id,
      combo_key: comboKey,
      status: 'generating',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,combo_key' });

    try {
      const photoPaths = stepItems.map(i => i.photo_url);
      const urlMap = await getSignedUrls(photoPaths);

      const steps = stepItems.map(i => ({
        category: i.category === 'sweatshirt_jacket' || i.category === 'shirts' ? 'upper' : 'lower',
        photoUrl: urlMap.get(i.photo_url) || i.photo_url,
        description: `${i.primary_color} ${i.subcategory}`.trim(),
      }));

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/outfit-tryon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ userId: user.id, comboKey, basePhotoUrl, steps }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success || !result?.path) {
        console.error('outfit-tryon failed:', response.status, result?.error, 'failedStep:', result?.failedStep);
        setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'failed' }));
        return;
      }

      const signedUrl = await getSignedUrl(result.path);
      setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'done', imageUrl: signedUrl }));
    } catch (err) {
      // The Edge Function already persisted its own result server-side by this
      // point in most failure modes (network drop here doesn't affect that) -
      // the next visit's ensureTryOn() will pick up whatever it landed on.
      console.error('ensureTryOn error:', err);
      setTryOnResults(prev => new Map(prev).set(comboKey, { status: 'failed' }));
    }
  };

  // Trigger generation the moment a candidate outfit is shown or regenerated -
  // not on "Wear This" - so it's already done (or in progress) by the time the
  // user looks at it.
  useEffect(() => {
    if (outfits.length > 0 && outfits[currentIndex]) {
      ensureTryOn(outfits[currentIndex].items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfits, currentIndex, basePhotoUrl]);

  useEffect(() => {
    if (savedOutfit?.items && savedOutfit.items.length > 0) {
      ensureTryOn(savedOutfit.items);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOutfit?.id, basePhotoUrl]);

  const currentComboKey = savedOutfit?.items?.length
    ? getComboKey(getTryOnStepItems(savedOutfit.items))
    : outfits.length && outfits[currentIndex]
      ? getComboKey(getTryOnStepItems(outfits[currentIndex].items))
      : null;
  const currentTryOnStatus = currentComboKey ? tryOnResults.get(currentComboKey)?.status : undefined;

  // Lightweight polling only while something is actually generating, and only
  // for as long as this component is mounted - navigating away just stops it;
  // the result is already durably saved server-side and will show up next visit.
  useEffect(() => {
    if (!currentComboKey || currentTryOnStatus !== 'generating' || !user) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('tryon_results')
        .select('status, image_url')
        .eq('user_id', user.id)
        .eq('combo_key', currentComboKey)
        .maybeSingle();

      if (data && data.status !== 'generating') {
        if (data.status === 'done' && data.image_url) {
          const signedUrl = await getSignedUrl(data.image_url);
          setTryOnResults(prev => new Map(prev).set(currentComboKey, { status: 'done', imageUrl: signedUrl }));
        } else {
          setTryOnResults(prev => new Map(prev).set(currentComboKey, { status: 'failed' }));
        }
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [currentComboKey, currentTryOnStatus, user]);

  const wearOutfit = async (outfit: GeneratedOutfit) => {
    if (!user) return;

    const { data, error } = await supabase
      .from('outfits')
      .insert({
        user_id: user.id,
        date: new Date().toISOString().split('T')[0],
        item_ids: outfit.items.map(i => i.id),
        source: outfit.source,
        activity_text: activity || null,
        worn: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving outfit:', error);
      return;
    }

    // Safety net only - ensureTryOn was already triggered when this candidate
    // was shown/regenerated, so this is normally a no-op (already generating/done).
    ensureTryOn(outfit.items);

    setSavedOutfit({ ...data, items: outfit.items });
    setOutfits([]);

    for (const item of outfit.items) {
      await supabase.rpc('increment_times_worn', { item_id: item.id });
    }
  };

  const rateOutfit = async (rating: 'up' | 'down') => {
    if (!savedOutfit) return;

    await supabase.from('outfits').update({ rating }).eq('id', savedOutfit.id);
    setSavedOutfit({ ...savedOutfit, rating });
  };

  const rateSuggestedOutfit = async (outfit: GeneratedOutfit, rating: 'up' | 'down') => {
    if (!user) return;

    const itemIds = outfit.items.map(i => i.id);
    const comboKey = itemIds.slice().sort().join('-');
    const today = new Date().toISOString().split('T')[0];

    // Check if a row for this exact combo + date already exists
    const { data: existing } = await supabase
      .from('outfits')
      .select('id, rating')
      .eq('user_id', user.id)
      .eq('date', today)
      .contains('item_ids', itemIds)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const newRating = existing.rating === rating ? existing.rating : rating;
      await supabase.from('outfits').update({ rating: newRating }).eq('id', existing.id);
      setSuggestedRatings(prev => new Map(prev).set(comboKey, newRating));
    } else {
      const { error } = await supabase
        .from('outfits')
        .insert({
          user_id: user.id,
          date: today,
          item_ids: itemIds,
          source: outfit.source,
          activity_text: activity || null,
          worn: false,
          rating,
        });

      if (!error) {
        setSuggestedRatings(prev => new Map(prev).set(comboKey, rating));
      }
    }
  };

  const currentOutfit = outfits[currentIndex];

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Today's Outfit</h2>
          <p className="text-sm text-slate-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {weatherLoading ? (
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1.5">
            <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
            <span className="text-xs text-slate-500">Weather…</span>
          </div>
        ) : weather ? (
          <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200 rounded-full px-3 py-1.5">
            <Thermometer className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-xs font-medium text-sky-700">{weather.temp}°F</span>
            <span className="text-xs text-sky-500">{weather.condition}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1.5">
            <CloudSun className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-500">No weather</span>
          </div>
        )}
      </div>

      {/* Weather hints */}
      {weatherHints.length > 0 && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-sky-700 space-y-0.5">
            {weatherHints.map((hint, i) => <p key={i}>{hint}</p>)}
          </div>
        </div>
      )}

      {/* Activity Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          What are you doing today?
        </label>
        <textarea
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          placeholder="e.g., gym then coffee with friends, work meeting, date night, wedding…"
          className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-shadow"
          rows={2}
        />
      </div>

      {/* Generate Button */}
      <button
        onClick={generateOutfits}
        disabled={generating}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-3 rounded-xl transition-colors mb-5"
      >
        {generating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Building outfits…
          </>
        ) : (
          <>
            <Sparkles className="w-5 h-5" />
            What should I wear?
          </>
        )}
      </button>

      {/* Today's worn outfit */}
      {savedOutfit && !outfits.length && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center">
              <Check className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-medium text-emerald-900 text-sm">Wearing this today</p>
              {savedOutfit.activity_text && (
                <p className="text-xs text-emerald-700">{savedOutfit.activity_text}</p>
              )}
            </div>
          </div>

          {currentTryOnStatus === 'generating' && (
            <div className="flex items-center justify-center gap-2 bg-white rounded-lg py-4 mb-3 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Still preparing your look…
            </div>
          )}

          {currentTryOnStatus === 'done' && tryOnResults.get(currentComboKey!)?.imageUrl && (
            <div className="rounded-lg overflow-hidden bg-slate-100 mb-3 aspect-[3/4] max-h-96">
              <img src={tryOnResults.get(currentComboKey!)?.imageUrl} alt="Today's outfit on you" className="w-full h-full object-contain" />
            </div>
          )}

          {savedOutfit.items && savedOutfit.items.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
              {savedOutfit.items.map((item) => (
                <div key={item.id} className="flex-shrink-0 w-24 aspect-[3/4] rounded-lg overflow-hidden bg-slate-100">
                  <img src={getPhotoUrl(item)} alt={item.subcategory} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500 mb-3">How was this outfit?</p>
          <div className="flex gap-2">
            <button
              onClick={() => rateOutfit('up')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                savedOutfit.rating === 'up'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-emerald-700 hover:bg-emerald-50'
              }`}
            >
              <ThumbsUp className="w-4 h-4" />
              Loved it
            </button>
            <button
              onClick={() => rateOutfit('down')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                savedOutfit.rating === 'down'
                  ? 'bg-slate-700 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <ThumbsDown className="w-4 h-4" />
              Not for me
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {outfits.length === 0 && !generating && !savedOutfit && (
        <div className="text-center py-10 animate-fade-in">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-emerald-600" />
          </div>
          <p className="text-slate-700 font-medium mb-1">Ready to plan your outfit?</p>
          <p className="text-sm text-slate-400 max-w-xs mx-auto">
            Tell us your plans for the day and we'll pick the perfect look from your closet.
          </p>
        </div>
      )}

      {/* Outfit Suggestions */}
      {outfits.length > 0 && (
        <div className="animate-fade-in">
          {/* Source badge + nav */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${
                  aiSource === 'ai'
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {aiSource === 'ai' ? <Wand2 className="w-3 h-3" /> : null}
                {aiSource === 'ai' ? 'AI picks' : 'Style rules'}
              </span>
              <span className="text-xs text-slate-400">
                {currentIndex + 1} / {outfits.length}
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600" />
              </button>
              <button
                onClick={() => setCurrentIndex(Math.min(outfits.length - 1, currentIndex + 1))}
                disabled={currentIndex === outfits.length - 1}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center disabled:opacity-30 hover:bg-slate-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          </div>

          {currentOutfit && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {/* Item photos grid */}
              <div
                className={`grid gap-0.5 ${
                  currentOutfit.items.length === 2 ? 'grid-cols-2' :
                  currentOutfit.items.length === 3 ? 'grid-cols-3' :
                  'grid-cols-2'
                }`}
              >
                {currentOutfit.items.slice(0, 4).map((item, idx) => (
                  <div
                    key={item.id}
                    className={`relative bg-slate-100 ${
                      currentOutfit.items.length === 4 && idx === 3 ? 'aspect-square' : 'aspect-[3/4]'
                    }`}
                  >
                    <img src={getPhotoUrl(item)} alt={item.subcategory} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                      <p className="text-white text-xs font-medium capitalize truncate">{item.subcategory}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Why this outfit */}
              <div className="p-4">
                <p className="text-sm text-slate-700 leading-relaxed mb-4">{currentOutfit.reason}</p>

                {/* Worn history badge + rating controls */}
                {(() => {
                  const comboKey = currentOutfit.items.map(i => i.id).sort().join('-');
                  const combo = pastOutfitCombos.get(comboKey);
                  const currentRating = suggestedRatings.get(comboKey);
                  return (
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-1.5">
                        {combo ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                            <Repeat className="w-3 h-3" />
                            Worn {combo.timesWorn}x · last worn {new Date(combo.lastWorn).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 font-medium">
                            <Sparkles className="w-3 h-3" />
                            New combo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => rateSuggestedOutfit(currentOutfit, 'up')}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            currentRating === 'up'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          <ThumbsUp className={`w-4 h-4 ${currentRating === 'up' ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          onClick={() => rateSuggestedOutfit(currentOutfit, 'down')}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            currentRating === 'down'
                              ? 'bg-red-500 text-white'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          <ThumbsDown className={`w-4 h-4 ${currentRating === 'down' ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Color harmony indicator */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex -space-x-1">
                    {currentOutfit.items.map((item) => (
                      <div
                        key={item.id}
                        title={item.primary_color}
                        className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: item.primary_color }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-slate-500">
                    {currentOutfit.colorScore >= 85 ? 'Great color match' :
                     currentOutfit.colorScore >= 65 ? 'Good color pairing' :
                     'Bold color combo'}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => wearOutfit(currentOutfit)}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-xl transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    Wear This
                  </button>
                  <button
                    onClick={() => setCurrentIndex((currentIndex + 1) % outfits.length)}
                    className="w-12 h-10 flex items-center justify-center bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                    title="See another outfit"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
