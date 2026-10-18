import { createContext, PropsWithChildren, useContext, useState } from 'react';

export type OnboardingFocus = 'shelf' | 'scan' | 'series' | 'wishlist' | 'settings' | null;
const Context = createContext<{ focus: OnboardingFocus; setFocus: (focus: OnboardingFocus) => void }>({
  focus: null, setFocus: () => {},
});

export function OnboardingProvider({ children }: PropsWithChildren) {
  const [focus, setFocus] = useState<OnboardingFocus>(null);
  return <Context.Provider value={{ focus, setFocus }}>{children}</Context.Provider>;
}

export function useOnboardingTour() {
  return useContext(Context);
}
