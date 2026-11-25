import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

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

export function useMe(): { me: Me | null; loading: boolean; refresh(): void } {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    api<Me>("/api/me")
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(() => {
    if (me) document.documentElement.style.setProperty("--font-scale", String(me.fontScale));
  }, [me]);

  return { me, loading, refresh };
}
