import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getSignedUrls, uploadInspirationPhoto } from '../lib/storage';
import { InspirationImage } from '../types';
import { ImagePlus, X, Loader2, Trash2, Palette, Sparkles, Layers, Check, ChevronLeft, RefreshCw } from 'lucide-react';
interface UploadProgress {
  fileName: string;
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error';
  error?: string;
}

interface AggregatedProfile {
  colorCounts: Record<string, number>;
  silhouetteCounts: Record<string, number>;
  patternCounts: Record<string, number>;
  totalImages: number;
}

const COLOR_HEX_MAP: Record<string, string> = {
  black: '#1a1a1a', white: '#f8f8f8', gray: '#9ca3af', navy: '#1e3a5f',
  blue: '#3b82f6', red: '#ef4444', brown: '#8b5e3c', beige: '#e8dcc8',
  green: '#22c55e', burgundy: '#7c2d3a', tan: '#d2b48c', cream: '#fff8e7',
  pink: '#f472b6', purple: '#a855f7', yellow: '#eab308', orange: '#f97316',
  olive: '#808000', teal: '#14b8a6', gold: '#d4af37', silver: '#c0c0c0',
};

function colorNameToHex(name: string): string {
  return COLOR_HEX_MAP[name.toLowerCase()] || '#9ca3af';
}

interface AnalysisResult {
  colorPalette: string[];
  silhouette: string;
  patternTrends: string[];
}

async function analyzeInspirationImage(base64: string): Promise<{ analysis?: AnalysisResult; error?: string; detail?: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-inspiration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify({ imageBase64: base64 }),
    });

    if (response.status === 429) {
      const { retryAfter } = await response.json().catch(() => ({ retryAfter: 15 }));
      if (attempt === 0) {
        // Gemini free-tier rate limit hit - wait out the window it told us, then try once more
        await new Promise(resolve => setTimeout(resolve, (retryAfter || 15) * 1000));
        continue;
      }
      return { error: 'Rate limited', detail: 'Still rate limited after waiting - try again in a minute.' };
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => 'unreadable');
      return { error: `HTTP ${response.status}`, detail: errBody.substring(0, 300) };
    }

    return response.json();
  }

  return { error: 'Rate limited' };
}

export function InspirationPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<InspirationImage[]>([]);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [selectedImage, setSelectedImage] = useState<InspirationImage | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Summary screen state
  const [showSummary, setShowSummary] = useState(false);
  const [newlyUploadedIds, setNewlyUploadedIds] = useState<string[]>([]);
  const [aggregated, setAggregated] = useState<AggregatedProfile | null>(null);
  const [summaryImageUrls, setSummaryImageUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (user) fetchImages();
  }, [user]);

  useEffect(() => {
    if (images.length > 0) {
      const paths = images.map(img => img.photo_url).filter(Boolean);
      getSignedUrls(paths).then(urlMap => setSignedUrls(urlMap));
    }
  }, [images]);

  const fetchImages = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('inspiration_images')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setImages(data);
    }
    setLoading(false);
  };

  const getPhotoUrl = (img: InspirationImage): string => {
    return signedUrls.get(img.photo_url) || img.photo_url;
  };

  const aggregateProfile = (imgs: InspirationImage[]): AggregatedProfile => {
    const colorCounts: Record<string, number> = {};
    const silhouetteCounts: Record<string, number> = {};
    const patternCounts: Record<string, number> = {};

    for (const img of imgs) {
      for (const c of img.color_palette || []) {
        const key = c.toLowerCase();
        colorCounts[key] = (colorCounts[key] || 0) + 1;
      }
      if (img.silhouette) {
        silhouetteCounts[img.silhouette] = (silhouetteCounts[img.silhouette] || 0) + 1;
      }
      for (const p of img.pattern_trends || []) {
        patternCounts[p] = (patternCounts[p] || 0) + 1;
      }
    }

    return { colorCounts, silhouetteCounts, patternCounts, totalImages: imgs.length };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !user) return;

    setUploading(true);
    setUploadProgress(files.map(f => ({ fileName: f.name, status: 'pending' as const })));

    const uploadedIds: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'uploading' } : p));

      try {
        const id = crypto.randomUUID();
        const photoUrl = await uploadInspirationPhoto(file, user.id, id);

        const { error: insertError } = await supabase.from('inspiration_images').insert({
          id,
          user_id: user.id,
          photo_url: photoUrl,
          analyzed: false,
        });

        if (insertError) throw insertError;
        uploadedIds.push(id);

        setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'analyzing' } : p));

        // AI analysis
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;

        const { analysis, error, detail } = await analyzeInspirationImage(base64);
        if (analysis) {
          await supabase
            .from('inspiration_images')
            .update({
              color_palette: analysis.colorPalette || [],
              silhouette: analysis.silhouette || '',
              pattern_trends: analysis.patternTrends || [],
              analyzed: true,
            })
            .eq('id', id);
        } else if (error) {
          console.error(`analyze-inspiration error for ${file.name}:`, error, detail || '');
        }

        setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'done' } : p));
      } catch (err) {
        console.error('Upload error for', file.name, err);
        setUploadProgress(prev => prev.map((p, idx) => idx === i ? { ...p, status: 'error', error: 'Failed' } : p));
      }
    }

    await fetchImages();
    setUploading(false);
    setTimeout(() => setUploadProgress([]), 2000);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Show summary screen with newly uploaded images
    if (uploadedIds.length > 0) {
      const { data: newImages } = await supabase
        .from('inspiration_images')
        .select('*')
        .in('id', uploadedIds);

      if (newImages && newImages.length > 0) {
        const analyzed = newImages.filter(img => img.analyzed);
        if (analyzed.length > 0) {
          setAggregated(aggregateProfile(analyzed));
        } else {
          setAggregated({ colorCounts: {}, silhouetteCounts: {}, patternCounts: {}, totalImages: newImages.length });
        }
        setNewlyUploadedIds(uploadedIds);

        // Get signed URLs for summary thumbnails
        const paths = newImages.map(img => img.photo_url).filter(Boolean);
        const urlMap = await getSignedUrls(paths);
        setSummaryImageUrls(urlMap);

        setShowSummary(true);
      }
    }
  };

  const confirmSummary = async () => {
    // Mark all newly uploaded images as confirmed
    if (newlyUploadedIds.length > 0) {
      await supabase
        .from('inspiration_images')
        .update({ confirmed: true })
        .in('id', newlyUploadedIds);
    }
    setShowSummary(false);
    setAggregated(null);
    setNewlyUploadedIds([]);
    setSummaryImageUrls(new Map());
    await fetchImages();
  };

  const deleteImage = async (img: InspirationImage) => {
    await supabase.from('inspiration_images').delete().eq('id', img.id);
    setImages(images.filter(i => i.id !== img.id));
    setSelectedImage(null);
    setConfirmingDelete(false);
  };

  const retryAnalysis = async (img: InspirationImage) => {
    setRetryingId(img.id);
    try {
      const photoUrl = getPhotoUrl(img);
      const res = await fetch(photoUrl);
      const blob = await res.blob();
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      const { analysis, error, detail } = await analyzeInspirationImage(base64);
      if (analysis) {
        await supabase.from('inspiration_images').update({
          color_palette: analysis.colorPalette || [],
          silhouette: analysis.silhouette || '',
          pattern_trends: analysis.patternTrends || [],
          analyzed: true,
        }).eq('id', img.id);
        await fetchImages();
        setSelectedImage(null);
      } else {
        console.error(`retry analyze-inspiration error for ${img.id}:`, error, detail || '');
        alert('Still rate limited by the AI service - it already waited and retried once. Try again in a minute.');
      }
    } catch (err) {
      console.error('Retry analysis error:', err);
      alert('Retry failed. Check your connection and try again.');
    } finally {
      setRetryingId(null);
    }
  };
    
  if (loading) {
    return (
      <div className="p-4 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Summary Screen
  if (showSummary && aggregated) {
    const sortedColors = Object.entries(aggregated.colorCounts).sort((a, b) => b[1] - a[1]);
    const sortedSilhouettes = Object.entries(aggregated.silhouetteCounts).sort((a, b) => b[1] - a[1]);
    const sortedPatterns = Object.entries(aggregated.patternCounts).sort((a, b) => b[1] - a[1]);
    const newImgs = images.filter(img => newlyUploadedIds.includes(img.id));

    return (
      <div className="p-4 pb-6 max-w-lg mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => {
              setShowSummary(false);
              setAggregated(null);
              setNewlyUploadedIds([]);
            }}
            className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Style Summary</h2>
            <p className="text-sm text-slate-500">
              {aggregated.totalImages} {aggregated.totalImages === 1 ? 'image' : 'images'} analyzed
            </p>
          </div>
        </div>

        {/* Thumbnail strip */}
        {newImgs.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4 -mx-4 px-4">
            {newImgs.map(img => (
              <div
                key={img.id}
                className="flex-shrink-0 w-16 h-20 rounded-lg overflow-hidden bg-slate-100"
              >
                <img
                  src={summaryImageUrls.get(img.photo_url) || img.photo_url}
                  alt="Upload"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}

        {/* AI confidence banner */}
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-violet-700">
            Here's what AI inferred from your inspiration images. Confirm to let these
            style traits influence your outfit recommendations.
          </p>
        </div>

        {/* Color Palette */}
        {sortedColors.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Palette className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Color Palette</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sortedColors.map(([color, count]) => (
                <div key={color} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-3 py-2">
                  <div
                    className="w-5 h-5 rounded-full border border-slate-200"
                    style={{ backgroundColor: colorNameToHex(color) }}
                  />
                  <span className="text-sm text-slate-700 capitalize">{color}</span>
                  <span className="text-xs text-slate-400">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Silhouettes */}
        {sortedSilhouettes.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Layers className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Silhouettes</p>
            </div>
            <div className="space-y-1.5">
              {sortedSilhouettes.map(([sil, count]) => (
                <div key={sil} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-700 capitalize">{sil}</span>
                  <span className="text-xs text-slate-400">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pattern Trends */}
        {sortedPatterns.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Sparkles className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Pattern Trends</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sortedPatterns.map(([pat, count]) => (
                <div key={pat} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-slate-700 capitalize">{pat}</span>
                  <span className="text-xs text-slate-400">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {sortedColors.length === 0 && sortedSilhouettes.length === 0 && sortedPatterns.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">
              AI couldn't extract style traits from these images.
              They'll still be saved but won't influence recommendations.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => {
              setShowSummary(false);
              setAggregated(null);
              setNewlyUploadedIds([]);
            }}
            className="flex-1 py-3 rounded-xl font-medium text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
          >
            Review Later
          </button>
          <button
            onClick={confirmSummary}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            <Check className="w-4 h-4" />
            Confirm & Apply
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Inspiration</h2>
          <p className="text-sm text-slate-500">Save looks you love — AI finds your style patterns</p>
        </div>
      </div>

      {/* Upload button */}
      <div className="mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl transition-colors"
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <ImagePlus className="w-5 h-5" />
              Add Inspiration Photos
            </>
          )}
        </button>
        <p className="text-xs text-slate-400 text-center mt-1.5">
          Select multiple photos or an entire folder at once
        </p>
      </div>

      {/* Upload progress */}
      {uploadProgress.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {uploadProgress.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate text-slate-600">{p.fileName}</span>
              {p.status === 'pending' && <span className="text-slate-400 text-xs">Queued</span>}
              {p.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              {p.status === 'analyzing' && <Sparkles className="w-3.5 h-3.5 text-violet-500" />}
              {p.status === 'done' && <span className="text-emerald-600 text-xs">Done</span>}
              {p.status === 'error' && <span className="text-red-500 text-xs">{p.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Images Grid */}
      {images.length === 0 ? (
        <div className="text-center py-12">
          <ImagePlus className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-1">No inspiration yet</p>
          <p className="text-sm text-slate-400">
            Upload screenshots, saved photos, or any looks that inspire you
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {images.map((img) => (
            <div
              key={img.id}
              className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100 group cursor-pointer"
              onClick={() => { setSelectedImage(img); setConfirmingDelete(false); }}
            >
              <img
                src={getPhotoUrl(img)}
                alt="Inspiration"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              {img.analyzed && (
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {img.confirmed && (
                    <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                  {!img.confirmed && (
                    <div className="w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center">
                      <Sparkles className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
              )}
              {img.analyzed && (
                <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {img.color_palette.length > 0 && (
                    <div className="flex gap-1 mb-1">
                      {img.color_palette.slice(0, 4).map((c, idx) => (
                        <div
                          key={idx}
                          className="w-4 h-4 rounded-full border border-white/50"
                          style={{ backgroundColor: colorNameToHex(c) }}
                        />
                      ))}
                    </div>
                  )}
                  {img.silhouette && (
                    <p className="text-white/90 text-xs truncate">{img.silhouette}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Full Image Preview Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center"
          onClick={() => { setSelectedImage(null); setConfirmingDelete(false); }}
        >
          <div
            className="bg-white rounded-t-3xl w-full max-w-lg max-h-[88vh] flex flex-col animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="overflow-y-auto flex-1 min-h-0">
              <div className="aspect-[3/4] w-full max-h-[50vh] bg-slate-100 relative">
                <img
                  src={getPhotoUrl(selectedImage)}
                  alt="Inspiration"
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => { setSelectedImage(null); setConfirmingDelete(false); }}
                  className="absolute top-3 right-3 w-8 h-8 bg-slate-900/70 rounded-full flex items-center justify-center text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  {selectedImage.analyzed ? (
                    selectedImage.confirmed ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-600 font-medium">
                        <Check className="w-3 h-3" />
                        Confirmed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-violet-100 text-violet-600 font-medium">
                        <Sparkles className="w-3 h-3" />
                        Analyzed — pending confirmation
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-500 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Pending analysis
                    </span>
                  )}
                  <span className="text-xs text-slate-400">
                    {new Date(selectedImage.created_at).toLocaleDateString()}
                  </span>
                </div>
                {!selectedImage.analyzed && (
            <button
              onClick={() => retryAnalysis(selectedImage)}
              disabled={retryingId === selectedImage.id}
              className="w-full flex items-center justify-center gap-2 bg-violet-50 hover:bg-violet-100 disabled:opacity-60 text-violet-700 text-sm font-medium py-2 rounded-lg transition-colors mb-3"
              >
              {retryingId === selectedImage.id ? (
                <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Retrying...
                </>
                ) : (
                <>
                <RefreshCw className="w-3.5 h-3.5" />
                Retry analysis
                </>
                )}
            </button>
        )}

                {selectedImage.analyzed && (
                  <>
                    {selectedImage.color_palette.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Palette className="w-4 h-4 text-slate-400" />
                          <p className="text-sm font-medium text-slate-700">Color Palette</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedImage.color_palette.map((c, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                              <div
                                className="w-4 h-4 rounded-full border border-slate-200"
                                style={{ backgroundColor: colorNameToHex(c) }}
                              />
                              <span className="text-sm text-slate-700 capitalize">{c}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedImage.silhouette && (
                      <div className="mb-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Layers className="w-4 h-4 text-slate-400" />
                          <p className="text-sm font-medium text-slate-700">Silhouette</p>
                        </div>
                        <p className="text-sm text-slate-600">{selectedImage.silhouette}</p>
                      </div>
                    )}

                    {selectedImage.pattern_trends.length > 0 && (
                      <div className="mb-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sparkles className="w-4 h-4 text-slate-400" />
                          <p className="text-sm font-medium text-slate-700">Pattern Trends</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedImage.pattern_trends.map((p, idx) => (
                            <span key={idx} className="text-sm px-2.5 py-1.5 bg-slate-50 rounded-lg text-slate-700 capitalize">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex gap-2 p-4 border-t border-slate-100 flex-shrink-0">
                <button
                  onClick={() => confirmingDelete ? deleteImage(selectedImage) : setConfirmingDelete(true)}
                  className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                    confirmingDelete
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                >
                  {confirmingDelete ? 'Confirm Delete' : (
                    <span className="flex items-center justify-center gap-1.5">
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </span>
                  )}
                </button>
                {confirmingDelete && (
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="flex-1 py-2.5 rounded-lg font-medium text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
