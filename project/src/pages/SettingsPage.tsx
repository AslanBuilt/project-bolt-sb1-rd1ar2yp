import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STYLE_TAGS } from '../types';
import { getSignedUrl, uploadBasePhoto } from '../lib/storage';
import { geocodeLocation } from '../lib/weather';
import { Check, Loader2, Palette, Trash2, User, Upload, MapPin, Thermometer, BarChart3, ChevronRight } from 'lucide-react';

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
  location_lat?: number | null;
  location_lon?: number | null;
  location_name?: string | null;
  temp_offset_f: number;
}

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState<StylePreferences>({
    style_tags: [],
    formality_range_min: 'casual',
    formality_range_max: 'smart-casual',
    temp_offset_f: 0,
  });
  const [itemCount, setItemCount] = useState(0);
  const [outfitCount, setOutfitCount] = useState(0);
      const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [basePhotoPreviewUrl, setBasePhotoPreviewUrl] = useState<string | null>(null);
  const [uploadingBasePhoto, setUploadingBasePhoto] = useState(false);
  const basePhotoInputRef = useRef<HTMLInputElement>(null);
  const [locationInput, setLocationInput] = useState('');
  const [geocodingLocation, setGeocodingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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
        location_lat: prefsResult.data.location_lat,
        location_lon: prefsResult.data.location_lon,
        location_name: prefsResult.data.location_name,
        temp_offset_f: prefsResult.data.temp_offset_f ?? 0,
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

  const saveLocation = async () => {
    if (!user || !locationInput.trim()) return;
    setGeocodingLocation(true);
    setLocationError(null);

    try {
      const resolved = await geocodeLocation(locationInput.trim());
      if (!resolved) {
        setLocationError("Couldn't find that location. Try a different spelling or a nearby major city.");
        return;
      }

      await supabase.from('style_preferences').upsert({
        user_id: user.id,
        location_lat: resolved.lat,
        location_lon: resolved.lon,
        location_name: resolved.name,
      }, { onConflict: 'user_id' });

      setPreferences((prev) => ({ ...prev, location_lat: resolved.lat, location_lon: resolved.lon, location_name: resolved.name }));
      setLocationInput('');
    } catch (err) {
      console.error('Error saving location:', err);
      setLocationError('Failed to save location. Please try again.');
    } finally {
      setGeocodingLocation(false);
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
        temp_offset_f: preferences.temp_offset_f,
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

      {/* Insights entry point */}
      <button
        onClick={() => navigate('/insights')}
        className="w-full flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4 mb-4 hover:border-emerald-300 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center">
            <BarChart3 className="w-4.5 h-4.5 text-emerald-600" />
          </div>
          <div className="text-left">
            <p className="font-medium text-slate-900 text-sm">Closet Insights</p>
            <p className="text-xs text-slate-500">Stats, most/least worn, what's sitting unused</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </button>

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

      {/* Weather Location */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-5 h-5 text-slate-400" />
          <h3 className="font-medium text-slate-900">Weather Location</h3>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Used to check today's forecast so recommendations skip clothes that don't match the weather.
        </p>

        {preferences.location_name && (
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-3 text-sm text-slate-700">
            <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            {preferences.location_name}
          </div>
        )}

        <div className="flex gap-2 mb-1">
          <input
            type="text"
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder="City name, e.g. Brooklyn, NY"
            className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={saveLocation}
            disabled={geocodingLocation || !locationInput.trim()}
            className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {geocodingLocation ? <Loader2 className="w-4 h-4 animate-spin" /> : (preferences.location_name ? 'Update' : 'Save')}
          </button>
        </div>
        {locationError && <p className="text-xs text-red-600 mb-2">{locationError}</p>}

        <div className="flex items-center gap-2 mt-4 mb-2">
          <Thermometer className="w-4 h-4 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">Runs cold / runs hot</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-10}
            max={10}
            step={1}
            value={preferences.temp_offset_f}
            onChange={(e) => setPreferences((prev) => ({ ...prev, temp_offset_f: Number(e.target.value) }))}
            className="flex-1"
          />
          <span className="text-sm text-slate-600 w-16 text-right">
            {preferences.temp_offset_f > 0 ? `+${preferences.temp_offset_f}` : preferences.temp_offset_f}°F
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Shifts how every recommendation reads the weather - positive if you tend to run cold, negative if you run hot. Saved with "Save Preferences" below.
        </p>
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
