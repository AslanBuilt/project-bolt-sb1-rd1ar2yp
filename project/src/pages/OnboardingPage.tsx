import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { STYLE_TAGS } from '../types';
import { Check, ChevronRight } from 'lucide-react';

const FORMALITY_LEVELS = [
  { value: 'casual', label: 'Casual', description: 'Jeans, t-shirts, sneakers' },
  { value: 'smart-casual', label: 'Smart Casual', description: 'Chinos, button-downs, loafers' },
  { value: 'formal', label: 'Formal', description: 'Suits, dress shoes, blazers' },
] as const;

type Step = 'styles' | 'formality' | 'done';

export function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('styles');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [minFormality, setMinFormality] = useState<'casual' | 'smart-casual' | 'formal'>('casual');
  const [maxFormality, setMaxFormality] = useState<'casual' | 'smart-casual' | 'formal'>('smart-casual');
  const [loading, setLoading] = useState(false);

  const toggleTag = (tag: string) => {
    setStyleTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleContinue = async () => {
    if (step === 'styles') {
      if (styleTags.length < 2) return;
      setStep('formality');
    } else if (step === 'formality') {
      await savePreferences();
      setStep('done');
    }
  };

  const savePreferences = async () => {
    if (!user) return;
    setLoading(true);

    await supabase.from('style_preferences').insert({
      user_id: user.id,
      style_tags: styleTags,
      formality_range_min: minFormality,
      formality_range_max: maxFormality,
      onboarding_completed: true,
    });

    setLoading(false);
  };

  const handleStart = () => {
    navigate('/today');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
      <div className="max-w-md mx-auto">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8 pt-4">
          <div
            className={`w-10 h-1 rounded-full transition-colors ${
              step !== 'styles' ? 'bg-emerald-500' : 'bg-emerald-500'
            }`}
          />
          <div
            className={`w-10 h-1 rounded-full transition-colors ${
              step === 'formality' || step === 'done' ? 'bg-emerald-500' : 'bg-slate-200'
            }`}
          />
          <div
            className={`w-10 h-1 rounded-full transition-colors ${
              step === 'done' ? 'bg-emerald-500' : 'bg-slate-200'
            }`}
          />
        </div>

        {step === 'styles' && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-semibold text-slate-900 text-center mb-2">
              What's your style?
            </h2>
            <p className="text-slate-600 text-center mb-6">
              Select at least 2 style tags that describe your look
            </p>

            <div className="flex flex-wrap gap-2 justify-center mb-6">
              {STYLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                    styleTags.includes(tag)
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'bg-white border-slate-300 text-slate-700 hover:border-emerald-400'
                  }`}
                >
                  {styleTags.includes(tag) && <Check className="w-4 h-4 inline mr-1" />}
                  {tag}
                </button>
              ))}
            </div>

            <button
              onClick={handleContinue}
              disabled={styleTags.length < 2}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 'formality' && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-semibold text-slate-900 text-center mb-2">
              Your formality range
            </h2>
            <p className="text-slate-600 text-center mb-6">
              What's the typical formality of your daily activities?
            </p>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Least formal</p>
                <div className="flex gap-2">
                  {FORMALITY_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setMinFormality(level.value)}
                      className={`flex-1 p-3 rounded-xl border text-center transition-all ${
                        minFormality === level.value
                          ? 'bg-emerald-50 border-emerald-500'
                          : 'bg-white border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <p className="font-medium text-sm text-slate-900">{level.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{level.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">Most formal</p>
                <div className="flex gap-2">
                  {FORMALITY_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setMaxFormality(level.value)}
                      className={`flex-1 p-3 rounded-xl border text-center transition-all ${
                        maxFormality === level.value
                          ? 'bg-emerald-50 border-emerald-500'
                          : 'bg-white border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      <p className="font-medium text-sm text-slate-900">{level.label}</p>
                      <p className="text-xs text-slate-500 mt-1">{level.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-3 rounded-xl transition-colors mt-6"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Save & Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center animate-fade-in">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-900 mb-2">
              Your style is set!
            </h2>
            <p className="text-slate-600 mb-6">
              Now let's add some clothes to your closet. You can add items one by one or upload multiple photos.
            </p>
            <button
              onClick={handleStart}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-xl transition-colors"
            >
              Start Adding Clothes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
