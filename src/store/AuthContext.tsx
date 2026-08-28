import { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { supabase } from '../lib/supabase';
import { disableNewReleaseNotifications } from '../lib/newReleaseNotifications';

type AuthContextValue = {
  configured: boolean;
  initializing: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthMessage(error: { message?: string }) {
  const message = error.message ?? '';
  if (/invalid login credentials/i.test(message)) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (/email not confirmed/i.test(message)) {
    return '確認メールのリンクを開いてからログインしてください。';
  }
  if (/user already registered/i.test(message)) {
    return 'このメールアドレスはすでに登録されています。';
  }
  if (/password/i.test(message)) {
    return 'パスワードの条件を満たしていません。6文字以上で入力してください。';
  }
  if (/fetch|network|timeout/i.test(message)) {
    return '通信できませんでした。接続を確認して、もう一度お試しください。';
  }
  return '認証処理を完了できませんでした。しばらくしてからもう一度お試しください。';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setInitializing(false);
      return;
    }

    client.auth
      .refreshSession()
      .then(({ data, error }) => {
        if (!error && data.session) {
          setSession(data.session);
          return;
        }
        return client.auth.getSession().then(({ data: storedData }) => setSession(storedData.session));
      })
      .catch(() => client.auth.getSession().then(({ data }) => setSession(data.session)))
      .finally(() => setInitializing(false));

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(toAuthMessage(error));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw new Error(toAuthMessage(error));
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const userId = session?.user.id;
    try {
      if (userId) {
        await disableNewReleaseNotifications(userId);
      }
    } catch (error) {
      console.warn('新刊通知トークンを無効化できませんでした', error);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [session?.user.id]);

  const value = useMemo(
    () => ({
      configured: !!supabase,
      initializing,
      session,
      user: session?.user ?? null,
      signIn,
      signUp,
      signOut,
    }),
    [initializing, session, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}


