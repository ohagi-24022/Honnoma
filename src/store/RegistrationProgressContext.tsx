import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

export type RegistrationFailure = { title: string; message: string };
export type RegistrationProgress = {
  id: number;
  seriesTitle: string;
  total: number;
  completed: number;
  currentTitle: string;
  added: number;
  skipped: number;
  failures: RegistrationFailure[];
  status: 'running' | 'complete';
};
type ProgressUpdate = Partial<Pick<RegistrationProgress, 'completed' | 'currentTitle' | 'added' | 'skipped'>>;
const Context = createContext<{
  job: RegistrationProgress | null;
  begin: (seriesTitle: string, total: number) => number;
  update: (id: number, update: ProgressUpdate) => void;
  finish: (id: number, result: { added: number; skipped: number; failures: RegistrationFailure[] }) => void;
  dismiss: () => void;
} | null>(null);

export function RegistrationProgressProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [job, setJob] = useState<RegistrationProgress | null>(null);
  const sequence = useRef(0);
  const running = useRef<number | null>(null);
  useEffect(() => { running.current = null; setJob(null); }, [user?.id]);
  const begin = useCallback((seriesTitle: string, total: number) => {
    if (running.current !== null) throw new Error('別の一括登録が進行中です。完了してからお試しください。');
    const id = ++sequence.current;
    running.current = id;
    setJob({ id, seriesTitle, total, completed: 0, currentTitle: '', added: 0, skipped: 0, failures: [], status: 'running' });
    return id;
  }, []);
  const update = useCallback((id: number, patch: ProgressUpdate) => {
    if (running.current !== id) return;
    setJob((current) => current?.id === id ? { ...current, ...patch } : current);
  }, []);
  const finish = useCallback((id: number, result: { added: number; skipped: number; failures: RegistrationFailure[] }) => {
    if (running.current !== id) return;
    running.current = null;
    setJob((current) => current?.id === id ? {
      ...current, ...result, failures: [...result.failures], completed: current.total, status: 'complete',
    } : current);
  }, []);
  const dismiss = useCallback(() => { setJob((current) => current?.status === 'complete' ? null : current); }, []);
  return <Context.Provider value={{ job, begin, update, finish, dismiss }}>{children}</Context.Provider>;
}

export function useRegistrationProgress() {
  const value = useContext(Context);
  if (!value) throw new Error('RegistrationProgressProvider is required');
  return value;
}
