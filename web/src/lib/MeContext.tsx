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
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Me> | null;
    return v && typeof v.id === "string" && v.today && typeof v.today === "object" ? (v as Me) : null;
  } catch {
    return null;
  }
}

export function clearMeCache() {
  try {
    localStorage.removeItem(ME_CACHE_KEY);
  } catch {
    // 無視
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
          // api() が /login へ遷移させる。前のアカウントの情報を残さない
          clearMeCache();
          setState({ me: null, status: "loading" });
        } else {
          setState({ me: null, status: "error" });
        }
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // オフライン中は、回線の復帰・画面の再表示で自動的に取り直す
  const offline = state.status === "offline";
  useEffect(() => {
    if (!offline) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [offline, refresh]);

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
