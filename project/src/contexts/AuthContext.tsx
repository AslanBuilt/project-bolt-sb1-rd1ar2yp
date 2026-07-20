import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  login: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async () => {
    // Sign in anonymously - creates a real Supabase session
      const { data, error } = await supabase.auth.signInWithPassword({ email: 'aiden@stylecloset.internal', password: '10mMSRYAH6D5E7wangQzBEUb' });
    if (error) {
      console.error('Anonymous sign-in failed:', error);
      return;
    }

    // The session is automatically persisted by Supabase
    // onAuthStateChange will update our state
    if (data.session) {
      setSession(data.session);
      setUser(data.session.user);

      // Ensure style preferences exist for this user
      await supabase.from('style_preferences').upsert({
        user_id: data.session.user.id,
        style_tags: ['minimalist', 'casual'],
        formality_range_min: 'casual',
        formality_range_max: 'smart-casual',
        onboarding_completed: true,
      }, { onConflict: 'user_id' });
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, login }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
