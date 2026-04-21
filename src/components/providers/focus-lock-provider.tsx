"use client";

import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useContext,
  useMemo,
  useState,
} from "react";

type FocusLockContextValue = {
  isLocked: boolean;
  setLocked: Dispatch<SetStateAction<boolean>>;
};

const FocusLockContext = createContext<FocusLockContextValue | null>(null);

export function FocusLockProvider({ children }: PropsWithChildren) {
  const [isLocked, setLocked] = useState(false);

  const value = useMemo(
    () => ({
      isLocked,
      setLocked,
    }),
    [isLocked],
  );

  return (
    <FocusLockContext.Provider value={value}>
      {children}
    </FocusLockContext.Provider>
  );
}

export function useFocusLock() {
  const context = useContext(FocusLockContext);
  if (!context) {
    throw new Error("useFocusLock must be used inside FocusLockProvider");
  }

  return context;
}
