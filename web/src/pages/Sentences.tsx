import { useCallback, useEffect, useState } from "react";
import { MarkedText } from "../components/MarkedText";
import { SlantButton, SlantLink } from "../components/SlantButton";
import { ApiError, OfflineError, api } from "../lib/api";
import { toSegments } from "../lib/cloze";
import { useMe } from "../lib/MeContext";

type Word = { id: string; english: string; japanese: string };
type Waiting = { words: Word[]; canGenerate: boolean; remainingToday: number };
type Draft = { englishMarked: string; japanese: string; wordIds: string[] };
type Sentence = { id: string; englishMarked: string; japanese: string; words: Word[] };
type SaveResponse = { id?: string; warning?: { missing: string[] } };

export const DRAFT_KEY = "wl_sentence_draft";

// 生成した下書きは sessionStorage に残す（再読み込みで AI の回数を無駄にしないため）
function loadDraft(): Draft | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as Partial<Draft> | null;
    if (v && typeof v.englishMarked === "string" && typeof v.japanese === "string" && Array.isArray(v.wordIds)) return v as Draft;
  } catch {
    // 壊れていたら下書きなしにする
  }
  return null;
}

function storeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

function generateError(err: unknown): string {
  if (err instanceof OfflineError) return "AI で文章を作るにはインターネット接続が必要です";
  if (err instanceof ApiError && err.status === 429) return "今日の AI 作成回数（10回）を使い切りました。明日また作れます";
  if (err instanceof ApiError && err.status === 502) return "AI の文章がうまく作れませんでした。もう一度お試しください（回数は1回消費されます）";
  return "文章を作れませんでした。もう一度お試しください";
}

export function Sentences() {
  const { me, refresh } = useMe();
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [draft, setDraftState] = useState<Draft | null>(loadDraft);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const setDraft = (d: Draft | null) => {
    setDraftState(d);
    storeDraft(d);
  };

  const load = useCallback(async () => {
    try {
      const [w, s] = await Promise.all([api<Waiting>("/api/sentences/waiting"), api<Sentence[]>("/api/sentences?status=reviewing")]);
      setWaiting(w);
      setSentences(s);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof OfflineError ? "オフラインのため、文章の一覧を読み込めません" : "読み込めませんでした");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const generate = (regenerate: boolean) =>
    run(async () => {
      try {
        const d = await api<Draft>(regenerate ? "/api/sentences/regenerate" : "/api/sentences/generate", {
          method: "POST",
          body: JSON.stringify(regenerate && draft ? { wordIds: draft.wordIds } : {}),
        });
        setDraft({ englishMarked: d.englishMarked, japanese: d.japanese, wordIds: d.wordIds });
        setEditing(false);
      } catch (err) {
        setError(generateError(err));
        if (err instanceof OfflineError) return;
      }
      void load(); // 残り回数を更新
    });

  const save = () =>
    run(async () => {
      if (!draft) return;
      const body = JSON.stringify(draft);
      try {
        const res = await api<SaveResponse>("/api/sentences", { method: "POST", body });
        if (res.warning) {
          const ok = window.confirm(`次の単語が文章に含まれていません: ${res.warning.missing.join("、")}。このまま保存しますか？`);
          if (!ok) return;
          await api<SaveResponse>("/api/sentences?force=1", { method: "POST", body });
        }
        setDraft(null);
        setEditing(false);
        await load();
        refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setDraft(null);
          setEditing(false);
          setError("この中の単語はすでに別の文章に使われています。作り直してください");
          await load();
        } else if (err instanceof OfflineError) {
          setError("保存にはインターネット接続が必要です");
        } else {
          setError("保存できませんでした。もう一度お試しください");
        }
      }
    });

  const due = me?.today.dueSentences ?? 0;
  const lacking = waiting ? Math.max(0, 5 - waiting.words.length) : 0;

  return (
    <>
      <div className="tag">STORY</div>
      <h1>文章</h1>
      {due > 0 && <SlantLink to="/sentences/review">▶ 文章の復習（{due}）</SlantLink>}
      {loadError && (
        <p role="alert" className="notice">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}

      {draft ? (
        <section className="story-card" aria-label="下書き">
          <div className="tag">DRAFT</div>
          {editing ? (
            <>
              <label className="field">
                英文（目印つき）
                <textarea
                  className="story-edit"
                  value={draft.englishMarked}
                  onChange={(e) => setDraft({ ...draft, englishMarked: e.target.value })}
                />
              </label>
              <p className="muted" style={{ margin: 0 }}>
                [[ ]] を消すと穴埋めに出ません
              </p>
              <label className="field">
                和訳
                <textarea className="story-edit" value={draft.japanese} onChange={(e) => setDraft({ ...draft, japanese: e.target.value })} />
              </label>
              <div className="tag">プレビュー</div>
              <p className="story-text" data-testid="preview">
                {toSegments(draft.englishMarked).length > 0 ? <MarkedText value={draft.englishMarked} /> : <span className="muted">（空です）</span>}
              </p>
            </>
          ) : (
            <>
              <p className="story-text">
                <MarkedText value={draft.englishMarked} />
              </p>
              <p className="story-ja">{draft.japanese}</p>
            </>
          )}
          <div className="two-buttons">
            <SlantButton variant="secondary" disabled={busy || draft.wordIds.length < 5} onClick={() => void generate(true)}>
              作り直す
            </SlantButton>
            <SlantButton variant="secondary" disabled={busy} onClick={() => setEditing((e) => !e)}>
              {editing ? "手直しを閉じる" : "手直し"}
            </SlantButton>
          </div>
          <SlantButton disabled={busy || !draft.englishMarked.trim() || !draft.japanese.trim()} onClick={() => void save()}>
            保存
          </SlantButton>
        </section>
      ) : (
        waiting && (
          <section aria-label="文章待ちの単語" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0 }}>文章待ちの単語: {waiting.words.length} 語</p>
            {waiting.words.length > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {waiting.words.map((w) => w.english).join("、")}
              </p>
            )}
            <SlantButton disabled={busy || !waiting.canGenerate} onClick={() => void generate(false)}>
              AI で文章を作る（残り {waiting.remainingToday} 回）
            </SlantButton>
            {lacking > 0 && (
              <p className="muted" style={{ margin: 0 }}>
                あと {lacking} 語たまると作れます
              </p>
            )}
          </section>
        )
      )}

      <h2>作成済みの文章</h2>
      {sentences.length === 0 ? (
        <p className="muted">まだありません</p>
      ) : (
        <ul className="story-list">
          {sentences.map((s) => (
            <li key={s.id} className="story-card">
              <p className="story-text" style={{ fontSize: "1rem" }}>
                <MarkedText value={s.englishMarked} />
              </p>
              <p className="story-ja">{s.japanese}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
