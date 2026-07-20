import { useAuth } from '../contexts/AuthContext';
import { User, Sparkles } from 'lucide-react';

export function AuthPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">StyleCloset</h1>
          <p className="text-slate-500 text-sm">Your personal wardrobe assistant</p>
        </div>

        {/* Single-user profile card */}
        <button
          onClick={login}
          className="w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-6 hover:shadow-xl hover:border-emerald-300 transition-all group"
        >
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center text-white text-xl font-bold shadow-md group-hover:scale-105 transition-transform">
              A
            </div>

            {/* Info */}
            <div className="flex-1 text-left">
              <h2 className="text-lg font-semibold text-slate-900 mb-0.5">Aiden</h2>
              <p className="text-sm text-slate-500">Tap to continue</p>
            </div>

            {/* Arrow */}
            <div className="w-10 h-10 bg-slate-100 group-hover:bg-emerald-100 rounded-full flex items-center justify-center transition-colors">
              <User className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
            </div>
          </div>
        </button>

        <p className="text-center text-xs text-slate-400 mt-6">
          Personal closet for your daily outfits
        </p>
      </div>
    </div>
  );
}
