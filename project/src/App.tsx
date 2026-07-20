import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { AuthPage } from './pages/AuthPage';
import { TodayPage } from './pages/TodayPage';
import { ClosetPage } from './pages/ClosetPage';
import { AddItemPage } from './pages/AddItemPage';
import { HistoryPage } from './pages/HistoryPage';
import { InspirationPage } from './pages/InspirationPage';
import { SettingsPage } from './pages/SettingsPage';
import { supabase } from './lib/supabase';
import { useState, useEffect } from 'react';

function AppRoutes() {
  const { user, loading } = useAuth();
  const [hasPreferences, setHasPreferences] = useState<boolean | null>(null);

  useEffect(() => {
    if (user) {
      supabase
        .from('style_preferences')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          setHasPreferences(!!data);
        });
    } else {
      setHasPreferences(null);
    }
  }, [user]);

  if (loading || (user && hasPreferences === null)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  // Create default preferences if missing
  if (hasPreferences === false) {
    supabase.from('style_preferences').upsert({
      user_id: user.id,
      style_tags: ['minimalist', 'casual'],
      formality_range_min: 'casual',
      formality_range_max: 'smart-casual',
      onboarding_completed: true,
    }).then(() => setHasPreferences(true));

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/today" element={<TodayPage />} />
        <Route path="/closet" element={<ClosetPage />} />
        <Route path="/add" element={<AddItemPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/inspiration" element={<InspirationPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/today" replace />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
