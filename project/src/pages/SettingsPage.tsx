import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STYLE_TAGS } from '../types';
import { getSignedUrl, uploadBasePhoto } from '../lib/storage';
import { Check, Loader2, Palette, Trash2, User, Upload } from 'lucide-react';

const FORMALITY_LEVELS = [
  { value: 'casual', label: 'Casual' },
  { value: 'smart-casual', label: 'Smart Casual' },
  { value: 'formal', label: 'Formal' },
] as const;

interface StylePreferences {
  style_tags: string[];
  formality_range_min: string;
  formality_range_max: string;
  base_photo_url?: string;
}

export function SettingsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<StylePreferences>({
    style_tags: [],
    formality_range_min: 'casual',
    formality_range_max: 'smart-casual',
  });
  const [itemCount, setItemCount] = useState(0);
  const [outfitCount, setOutfitCount] = useState(0);
      const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [basePhotoPreviewUrl, setBasePhotoPreviewUrl] = useState<string | null>(null);
  const [uploadingBasePhoto, setUploadingBasePhoto] = useState(false);
  const basePhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    const [prefsResult, itemsResult, outfitsResult] = await Promise.all([
      supabase.from('style_preferences').select('*').eq('user_id', user!.id).maybeSingle(),
      supabase.from('clothing_items').select('id', { count: 'exact' }).eq('retired', false),
      supabase.from('outfits').select('id', { count: 'exact' }),
    ]);

    if (prefsResult.data) {
      setPreferences({
        style_tags: prefsResult.data.style_tags || [],
        formality_range_min: prefsResult.data.formality_range_min || 'casual',
        formality_range_max: prefsResult.data.formality_range_max || 'smart-casual',
        base_photo_url: prefsResult.data.base_photo_url || undefined,
      });

      if (prefsResult.data.base_photo_url) {
        const signedUrl = await getSignedUrl(prefsResult.data.base_photo_url);
        setBasePhotoPreviewUrl(signedUrl);
      }
    }

    if (itemsResult.count !== null) setItemCount(itemsResult.count);
    if (outfitsResult.count !== null) setOutfitCount(outfitsResult.count);

    setLoading(false);
  };

  const handleBasePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingBasePhoto(true);
    try {
      const path = await uploadBasePhoto(file, user.id);
      await supabase.from('style_preferences').upsert({
        user_id: user.id,
        base_photo_url: path,
      }, { onConflict: 'user_id' });

      setPreferences((prev) => ({ ...prev, base_photo_url: path }));
      const signedUrl = await getSignedUrl(path);
      setBasePhotoPreviewUrl(signedUrl);
    } catch (err) {
      console.error('Error uploading base photo:', err);
      alert('Failed to upload photo. Please try again.');
    } finally {
      setUploadingBasePhoto(false);
      if (basePhotoInputRef.current) basePhotoInputRef.current.value = '';
    }
  };

  const toggleTag = (tag: string) => {
    setPreferences((prev) => ({
      ...prev,
      style_tags: prev.style_tags.includes(tag)
        ? prev.style_tags.filter((t) => t !== tag)
        : [...prev.style_tags, tag],
    }));
  };

  const savePreferences = async () => {
    if (!user) return;
    setSaving(true);

    await supabase
      .from('style_preferences')
      .upsert({
        user_id: user.id,
        style_tags: preferences.style_tags,
        formality_range_min: preferences.formality_range_min,
        formality_range_max: preferences.formality_range_max,
      });

    setSaving(false);
  };

  const handleDeleteAllItems = async () => {
    
    // Delete items
    await supabase.from('clothing_items').delete().eq('user_id', user!.id);
    setItemCount(0);
        setConfirmingDeleteAll(false);
  };

  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto">
      <h2 className="text-xl font-semibold text-slate-900 mb-6">Settings</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-semibold text-slate-900">{itemCount}</p>
          <p className="text-sm text-slate-500">Items in closet</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-2xl font-semibold text-slate-900">{outfitCount}</p>
          <p className="text-sm text-slate-500">Outfits worn</p>
        </div>
      </div>

      {/* User info */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold">
            A
          </div>
          <div>
            <p className="font-medium text-slate-900">Aiden</p>
            <p className="text-sm text-slate-500">Personal closet</p>
          </div>
        </div>
      </div>

      {/* Try-On Base Photo */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <User className="w-5 h-5 text-slate-400" />
          <h3 className="font-medium text-slate-900">Outfit Try-On Photo</h3>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          A front-facing, full-body photo on a plain background. Used to visualize each day's recommended outfit on you.
        </p>

        <div className="flex items-center gap-3">
          <div className="w-20 h-28 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex-shrink-0 flex items-center justify-center">
            {basePhotoPreviewUrl ? (
              <img src={basePhotoPreviewUrl} alt="Try-on base" className="w-full h-full object-cover" />
            ) : (
              <User className="w-8 h-8 text-slate-300" />
            )}
          </div>

          <div className="flex-1">
            <input
              ref={basePhotoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBasePhotoSelect}
            />
            <button
              onClick={() => basePhotoInputRef.current?.click()}
              disabled={uploadingBasePhoto}
              className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-medium py-2 rounded-lg text-sm transition-colors"
            >
              {uploadingBasePhoto ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {preferences.base_photo_url ? 'Replace photo' : 'Upload photo'}
            </button>
          </div>
        </div>
      </div>

      {/* Style Tags */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-slate-400" />
          <h3 className="font-medium text-slate-900">My Style</h3>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {STYLE_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                preferences.style_tags.includes(tag)
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
              }`}
            >
              {preferences.style_tags.includes(tag) && <Check className="w-3 h-3 inline mr-1" />}
              {tag}
            </button>
          ))}
        </div>

        {/* Formality Range */}
        <p className="text-sm font-medium text-slate-700 mb-2">Formality Range</p>
        <div className="flex gap-2 mb-4">
          <select
            value={preferences.formality_range_min}
            onChange={(e) =>
              setPreferences((prev) => ({ ...prev, formality_range_min: e.target.value }))
            }
            className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {FORMALITY_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
          <span className="text-slate-400 self-center">to</span>
          <select
            value={preferences.formality_range_max}
            onChange={(e) =>
              setPreferences((prev) => ({ ...prev, formality_range_max: e.target.value }))
            }
            className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {FORMALITY_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={savePreferences}
          disabled={saving || preferences.style_tags.length < 1}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          Save Preferences
        </button>
      </div>

      {/* Danger zone */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <h3 className="font-medium text-red-900 mb-2">Danger Zone</h3>
        <p className="text-sm text-red-700 mb-3">
          Clear your closet data without affecting your style preferences.
        </p>
        <button
          onClick={() => confirmingDeleteAll ? handleDeleteAllItems() : setConfirmingDeleteAll(true)}
          className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          {confirmingDeleteAll ? 'Tap again to confirm delete' : 'Delete All Items'}
        </button>
      </div>
    </div>
  );
}
