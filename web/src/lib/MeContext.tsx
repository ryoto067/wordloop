import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { OfflineError, api } from "./api";

export type Me = {
  id: string;
  name: string;
  email: string;
  timezone: string;
  wordIntervals: number[];
  sentenceIntervals: number[];
  fontScale: number;
  streak: number;
  today: { dueWords: number; dueSentences: number; waitingWords: number; doneToday: boolean };
};

export type MeStatus = "loading" | "ready" | "offline" | "error";
export type MeState = { me: Me | null; status: MeStatus; refresh(): void };

export const ME_CACHE_KEY = "wl_me";

function readCache(): Me | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

function writeCache(me: Me) {
  try {
    localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
  } catch {
    // 保存できなくても動作には影響しない
  }
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ me: Me | null; status: MeStatus }>({ me: null, status: "loading" });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api<Me>("/api/me")
      .then((me) => {
        if (!alive) return;
        writeCache(me);
        setState({ me, status: "ready" });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof OfflineError) {
          const cached = readCache();
          setState(cached ? { me: cached, status: "offline" } : { me: null, status: "error" });
        } else if ((err as { status?: number }).status === 401) {
          // api() が /login へ遷移させる。ここでは何も表示しない
          setState({ me: null, status: "loading" });
        } else {
          setState({ me: null, status: "error" });
        }
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    if (state.me) document.documentElement.style.setProperty("--font-scale", String(state.me.fontScale));
  }, [state.me]);

  return <MeContext.Provider value={{ ...state, refresh }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe は MeProvider の内側で使ってください");
  return ctx;
}
