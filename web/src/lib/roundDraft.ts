// 周回中の状態。localStorage に保存し、アプリを閉じても復元する
export type DraftWord = { english: string; japanese: string; id?: string };

export type RoundDraft = {
  mode: "first" | "next";
  setId?: string;
  setName?: string;
  roundNo: number;
  startedAt: string;
  pausedMs: number;
  pausedAt?: string; // 一時停止中なら、停止を始めた時刻
  stoppedAt?: string;
  words: DraftWord[];
  link?: string[]; // 「このセットにも入れる」を選んだ登録済みの英単語
  roundId?: string; // 2 周目以降: テスト開始後
};

export const DRAFT_KEY = "wl_round_draft";

export function saveDraft(d: RoundDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // 保存できなくても動作には影響しない
  }
}

export function loadDraft(): RoundDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RoundDraft> | null;
    if (!v || (v.mode !== "first" && v.mode !== "next")) return null;
    if (typeof v.roundNo !== "number" || typeof v.startedAt !== "string" || !Array.isArray(v.words)) return null;
    return { ...v, pausedMs: typeof v.pausedMs === "number" ? v.pausedMs : 0 } as RoundDraft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 無視
  }
}

// 経過秒（一時停止していた分を除く）。STOP 後は stoppedAt で止まる
export function elapsedSec(d: RoundDraft, now: number): number {
  const end = d.stoppedAt ? Date.parse(d.stoppedAt) : now;
  const current = d.pausedAt && !d.stoppedAt ? Math.max(0, end - Date.parse(d.pausedAt)) : 0;
  const ms = end - Date.parse(d.startedAt) - d.pausedMs - current;
  return Math.max(0, Math.floor(ms / 1000));
}

export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function resumePath(d: RoundDraft): string {
  if (d.mode === "first") return d.stoppedAt ? "/round/entry" : "/round/timer";
  return d.roundId ? "/round/test" : "/round/timer";
}
