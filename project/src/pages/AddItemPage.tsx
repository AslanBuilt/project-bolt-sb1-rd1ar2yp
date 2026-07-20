import { useState, useRef, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { uploadClothingPhoto } from '../lib/storage';
import { useAuth } from '../contexts/AuthContext';
import { CATEGORY_SUBCATEGORIES, COLORS, ClothingCategory, Pattern, Formality, Season } from '../types';
import { Camera, X, ChevronDown, Check, Loader2, Sparkles, Wand2, AlertCircle } from 'lucide-react';

const PATTERNS: Pattern[] = ['solid', 'striped', 'plaid', 'floral', 'geometric', 'printed', 'other'];
const FORMALITY_LEVELS: Formality[] = ['casual', 'smart-casual', 'formal'];
const SEASONS: Season[] = ['spring', 'summer', 'fall', 'winter', 'all'];
const CONFIDENCE_THRESHOLD = 0.7;

interface AITags {
  category: ClothingCategory;
  subcategory: string;
  primaryColor: string;
  secondaryColor?: string;
  pattern: Pattern;
  formality: Formality;
  confidence: number;
  fieldConfidence: {
    category: number;
    subcategory: number;
    primaryColor: number;
    secondaryColor: number;
    pattern: number;
    formality: number;
  };
}

function UncertainBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 font-medium ml-1">
      <AlertCircle className="w-3 h-3" />
    </span>
  );
}

export function AddItemPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAnalyzedPhotoRef = useRef<File | null>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [category, setCategory] = useState<ClothingCategory | ''>('');
  const [subcategory, setSubcategory] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [pattern, setPattern] = useState<Pattern>('solid');
  const [formality, setFormality] = useState<Formality>('casual');
  const [season, setSeason] = useState<Season>('all');

  const [aiConfidence, setAiConfidence] = useState<number>(1.0);
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, number>>({});

  useEffect(() => {
    if (photo) {
      const url = URL.createObjectURL(photo);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [photo]);

  useEffect(() => {
    if (category && CATEGORY_SUBCATEGORIES[category]) {
      setSubcategory(CATEGORY_SUBCATEGORIES[category][0]);
    }
  }, [category]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setAiError(null);
      lastAnalyzedPhotoRef.current = null;
    }
  };

  const detectWithAI = useCallback(async (photoFile: File) => {
    if (lastAnalyzedPhotoRef.current === photoFile) return;

    setDetecting(true);
    setAiError(null);
    lastAnalyzedPhotoRef.current = photoFile;

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(photoFile);
      });

      const base64 = await base64Promise;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/ai-tag-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });

      if (!response.ok) {
        throw new Error('AI tagging failed');
      }

      const result = await response.json();

      if (result.tags) {
        const tags: AITags = result.tags;

        setCategory(tags.category as ClothingCategory);
        if (CATEGORY_SUBCATEGORIES[tags.category]?.includes(tags.subcategory)) {
          setSubcategory(tags.subcategory);
        } else {
          const subs = CATEGORY_SUBCATEGORIES[tags.category] || [];
          const match = subs.find(s => s.toLowerCase().includes(tags.subcategory.toLowerCase()));
          setSubcategory(match || subs[0] || tags.subcategory);
        }
        setPrimaryColor(tags.primaryColor.toLowerCase());
        if (tags.secondaryColor) {
          setSecondaryColor(tags.secondaryColor.toLowerCase());
        }
        setPattern(tags.pattern);
        setFormality(tags.formality);

        setAiConfidence(tags.confidence ?? 1.0);
        setFieldConfidence(tags.fieldConfidence || {});
      }
    } catch (err) {
      console.error('AI detection error:', err);
      setAiError('Could not auto-detect. Please tag manually.');
    } finally {
      setDetecting(false);
    }
  }, []);

  const handleReanalyze = () => {
    if (!photo) return;
    lastAnalyzedPhotoRef.current = null;
    detectWithAI(photo);
  };

  useEffect(() => {
    if (photo && preview && !detecting && lastAnalyzedPhotoRef.current !== photo) {
      detectWithAI(photo);
    }
  }, [photo, preview, detecting, detectWithAI]);

  const isFieldUncertain = (field: string) => {
    const conf = fieldConfidence[field];
    return conf !== undefined && conf < CONFIDENCE_THRESHOLD;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !photo || !category) return;

    setLoading(true);

    try {
      const id = crypto.randomUUID();
      const photoUrl = await uploadClothingPhoto(photo, user.id, id);

      const uncertainFields = Object.entries(fieldConfidence)
        .filter(([, conf]) => conf < CONFIDENCE_THRESHOLD)
        .map(([field]) => field);

      const { error } = await supabase.from('clothing_items').insert({
        id,
        user_id: user.id,
        photo_url: photoUrl,
        category,
        subcategory,
        primary_color: primaryColor || 'gray',
        secondary_color: secondaryColor || null,
        pattern,
        formality,
        season,
        ai_confidence: aiConfidence,
        ai_uncertain_fields: uncertainFields,
      });

      if (error) throw error;

      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        resetForm();
      }, 1500);
    } catch (err) {
      console.error('Error saving item:', err);
      alert('Failed to save item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setPhoto(null);
    setPreview(null);
    setCategory('');
    setSubcategory('');
    setPrimaryColor('');
    setSecondaryColor('');
    setPattern('solid');
    setFormality('casual');
    setSeason('all');
    setAiError(null);
    setAiConfidence(1.0);
    setFieldConfidence({});
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isFormValid = photo && category && subcategory && primaryColor;

  if (showSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center animate-bounce-in">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <p className="text-lg font-medium text-slate-900">Item added!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-6 max-w-lg mx-auto">
      <h2 className="text-xl font-semibold text-slate-900 mb-4">Add New Item</h2>

      <div
        onClick={() => fileInputRef.current?.click()}
        className={`relative aspect-[3/4] max-h-[45vh] mx-auto mb-4 rounded-2xl overflow-hidden border-2 border-dashed transition-all cursor-pointer ${
          preview
            ? 'border-emerald-500 bg-slate-900'
            : 'border-slate-300 bg-slate-50 hover:border-emerald-400'
        }`}
      >
        {preview ? (
          <img src={preview} alt="Preview" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Camera className="w-10 h-10" />
            <p className="text-sm font-medium">Take or upload a photo</p>
            <p className="text-xs text-slate-400">Single item, plain background works best</p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />
        {preview && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              resetForm();
            }}
            className="absolute top-3 right-3 w-8 h-8 bg-slate-900/70 rounded-full flex items-center justify-center text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {detecting && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
              <span className="text-sm font-medium text-slate-700">Analyzing...</span>
            </div>
          </div>
        )}
      </div>

      {aiError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-700">{aiError}</span>
        </div>
      )}

      {preview && (
        <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
          {!detecting && (
            <button
              type="button"
              onClick={handleReanalyze}
              className="w-full flex items-center justify-center gap-2 bg-violet-100 hover:bg-violet-200 text-violet-700 font-medium py-2.5 rounded-lg transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Re-analyze
            </button>
          )}

          {/* AI confidence banner */}
          {!detecting && aiConfidence < CONFIDENCE_THRESHOLD && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <span className="text-sm text-amber-700">
                AI is uncertain about some tags. Fields marked with
                <span className="inline-flex items-center mx-1"><AlertCircle className="w-3 h-3" /></span>
                need a quick check — just tap the correct option.
              </span>
            </div>
          )}

          {/* Category — quick-correct chips */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Category
              {isFieldUncertain('category') && <UncertainBadge />}
            </label>
            <div className="flex flex-wrap gap-2">
              {(['shirts', 'sweatshirt_jacket', 'pants', 'shorts', 'shoes'] as ClothingCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    category === cat
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {cat === 'sweatshirt_jacket' ? 'Sweatshirt/Jacket' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Subcategory — quick-correct chips */}
          {category && (
            <div className="animate-fade-in">
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Type
                {isFieldUncertain('subcategory') && <UncertainBadge />}
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_SUBCATEGORIES[category].map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setSubcategory(sub)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                      subcategory === sub
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                    }`}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Primary Color — quick-correct chips */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Primary Color
              {isFieldUncertain('primaryColor') && <UncertainBadge />}
            </label>
            <div className="flex flex-wrap gap-2">
              {COLORS.slice(0, -1).map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setPrimaryColor(color)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    primaryColor === color
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {color}
                </button>
              ))}
            </div>
          </div>

          {/* Pattern — quick-correct chips */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Pattern
              {isFieldUncertain('pattern') && <UncertainBadge />}
            </label>
            <div className="flex flex-wrap gap-2">
              {PATTERNS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPattern(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    pattern === p
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Formality — quick-correct chips */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Formality
              {isFieldUncertain('formality') && <UncertainBadge />}
            </label>
            <div className="flex gap-2">
              {FORMALITY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormality(level)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                    formality === level
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Season — quick-correct chips */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Season</label>
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeason(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    season === s
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!isFormValid || loading}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Check className="w-4 h-4" />
                Add to Closet
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
