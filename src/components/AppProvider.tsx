"use client";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { analyse, type Analysis } from "@/lib/analysis";
import { appReducer, emptyState, isAppState, sampleState, STORAGE_KEY, type AppAction, type AppState } from "@/lib/store";

interface Ctx {
  state: AppState;
  dispatch: (a: AppAction) => void;
  analysis: Analysis;
  ready: boolean;
  storageOk: boolean;
}

const AppContext = createContext<Ctx | null>(null);

export const now = () => new Date().toISOString();

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, undefined, emptyState);
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let loaded: AppState | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isAppState(parsed)) loaded = parsed;
      }
    } catch {
      setStorageOk(false);
    }
    dispatch({ type: "HYDRATE", state: loaded ?? sampleState(now()) });
    setReady(true);
  }, []);

  const latest = useRef(state);
  const dirty = useRef(false);
  const persist = () => {
    if (!dirty.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current));
      dirty.current = false;
      setStorageOk(true);
    } catch {
      setStorageOk(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    latest.current = state;
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 300);
  }, [state, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush a pending save if the tab is hidden, reloaded or closed inside the debounce window.
  useEffect(() => {
    const flush = () => persist();
    const onVisibility = () => document.visibilityState === "hidden" && persist();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const analysis = useMemo(
    () => analyse({ transactions: state.transactions, interventions: state.interventions, asOf: state.asOf, assumptions: state.assumptions, suppressedUntil: state.suppressedUntil }),
    [state.transactions, state.interventions, state.asOf, state.assumptions, state.suppressedUntil],
  );

  return <AppContext.Provider value={{ state, dispatch, analysis, ready, storageOk }}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}

/** Event fired when a customer is opened on the page that is already showing (e.g. from the Copilot). */
export const OPEN_CUSTOMER_EVENT = "regain:open-customer";

/** Reads ?id= from the URL on the client (avoids Suspense requirements of useSearchParams). */
export function useQueryId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get("id"));
    const onOpen = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_CUSTOMER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CUSTOMER_EVENT, onOpen);
  }, []);
  return id;
}
