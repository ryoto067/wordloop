import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Navigate } from "react-router";
import { AbandonButton } from "../components/AbandonButton";
import { SlantButton, SlantLink } from "../components/SlantButton";
import { OfflineError, api } from "../lib/api";
import { useMe } from "../lib/MeContext";
import { enqueue, flush, size } from "../lib/offlineQueue";
import { clearDraft, elapsedSec, formatTime, loadDraft, saveDraft, type DraftWord, type RoundDraft } from "../lib/roundDraft";

type Existing = { english: string; wordId: string; setNames: string[] };

// 日本語入力の変換確定の Enter は送信として扱わない
export function isComposingEnter(e: KeyboardEvent<HTMLInputElement>): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

const key = (s: string) => s.trim().toLowerCase();

export function Entry() {
  const { refresh } = useMe();
  const [draft, setDraft] = useState<RoundDraft | null>(loadDraft);
  const [english, setEnglish] = useState("");
  const [japanese, setJapanese] = useState("");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [existing, setExisting] = useState<Record<string, Existing>>({});
  const [saved, setSaved] = useState<{ count: number; sec: number; pending: boolean; offline: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enRef = useRef<HTMLInputElement>(null);
  const jaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    enRef.current?.focus();
  }, []);

  if (saved) {
    return (
      <>
        <div className="tag">COMPLETE</div>
        <h1>今日覚えた単語 {saved.count} 語</h1>
        <div className="num-italic" style={{ fontSize: "4rem" }}>
          {formatTime(saved.sec)}
        </div>
        {saved.pending && (
          <p role="status" className="notice">
            {saved.offline ? "オフラインのため、つながったら保存します" : "保存待ちです。あとで自動で送信します"}
          </p>
        )}
        <SlantLink to="/">ホームへ</SlantLink>
      </>
    );
  }
  if (!draft || draft.mode !== "first") return <Navigate to="/" replace />;
  if (!draft.stoppedAt) return <Navigate to="/round/timer" replace />;

  const update = (d: RoundDraft) => {
    saveDraft(d);
    setDraft(d);
  };

  const checkEnglish = async () => {
    const w = english.trim();
    if (!w || !navigator.onLine) return; // オフラインでは登録済みの案内を出さない
    try {
      const r = await api<{ existing: Existing[] }>("/api/words/check", { method: "POST", body: JSON.stringify({ english: [w] }) });
      setExisting((prev) => {
        const next = { ...prev };
        delete next[key(w)];
        for (const e of r.existing) next[key(e.english)] = e;
        return next;
      });
    } catch {
      // 案内が出ないだけ。入力は止めない
    }
  };

  const onEnglishKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || isComposingEnter(e)) return;
    e.preventDefault();
    if (!english.trim()) return;
    jaRef.current?.focus();
  };

  // 入力中の 1 語を一覧に入れた単語リストを返す（英語・日本語の両方があるときだけ）
  const withPending = (): DraftWord[] => {
    const w: DraftWord = { english: english.trim(), japanese: japanese.trim() };
    if (!w.english || !w.japanese) return draft.words;
    const words = [...draft.words];
    if (editIndex !== null) words[editIndex] = w;
    else words.push(w);
    return words;
  };

  const addWord = () => {
    if (!english.trim()) return enRef.current?.focus();
    if (!japanese.trim()) return jaRef.current?.focus();
    update({ ...draft, words: withPending() });
    setEnglish("");
    setJapanese("");
    setEditIndex(null);
    enRef.current?.focus();
  };

  const onJapaneseKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || isComposingEnter(e)) return;
    e.preventDefault();
    addWord();
  };

  const edit = (i: number) => {
    setEditIndex(i);
    setEnglish(draft.words[i].english);
    setJapanese(draft.words[i].japanese);
    enRef.current?.focus();
  };

  const remove = (i: number) => {
    update({ ...draft, words: draft.words.filter((_, j) => j !== i) });
    setEditIndex(null);
    setEnglish("");
    setJapanese("");
  };

  const toggleLink = (w: string) => {
    const set = new Set(draft.link ?? []);
    if (set.has(key(w))) set.delete(key(w));
    else set.add(key(w));
    update({ ...draft, link: [...set] });
  };

  const hint = existing[key(english)];
  const link = new Set(draft.link ?? []);

  const save = async () => {
    const words = withPending();
    if (words.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    const sec = elapsedSec(draft, Date.now());
    const present = new Set(words.map((w) => key(w.english)));
    const body = {
      startedAt: draft.startedAt,
      durationSec: sec,
      words: words.map((w) => ({ english: w.english, japanese: w.japanese })),
      linkExisting: [...link].filter((e) => present.has(e) && existing[e]).map((e) => existing[e].english),
    };
    try {
      await enqueue({ id: crypto.randomUUID(), kind: "other", path: "/api/rounds/first", body });
      await flush().catch((err) => {
        if (!(err instanceof OfflineError)) console.warn("flush に失敗しました", err);
      });
      const pending = (await size()) > 0;
      clearDraft();
      setSaved({ count: words.length, sec, pending, offline: !navigator.onLine });
      refresh();
    } catch {
      setError("保存できませんでした。もう一度お試しください");
      setSaving(false);
    }
  };

  return (
    <>
      <div className="tag">ENTRY ・ {editIndex === null ? draft.words.length + 1 : editIndex + 1} 語目</div>
      <p className="muted" style={{ margin: 0, fontSize: "0.9em" }}>
        英単語と日本語訳を入れて「＋ 追加」（またはキーボードの改行）で次の単語へ。全部入れたら「保存して完了」。一覧の単語はタップで直せます。
      </p>
      <label className="field">
        <span>英単語</span>
        <input
          ref={enRef}
          value={english}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          onChange={(e) => setEnglish(e.target.value)}
          onKeyDown={onEnglishKey}
          onBlur={() => void checkEnglish()}
        />
      </label>
      {hint && (
        <div className="notice" role="status">
          <p style={{ margin: 0 }}>登録済み（{hint.setNames.join("・") || "セットなし"}）</p>
          <label>
            <input type="checkbox" checked={link.has(key(hint.english))} onChange={() => toggleLink(hint.english)} /> このセットにも入れる
          </label>
        </div>
      )}
      <label className="field">
        <span>日本語訳</span>
        <input ref={jaRef} value={japanese} enterKeyHint="done" onChange={(e) => setJapanese(e.target.value)} onKeyDown={onJapaneseKey} />
      </label>
      <SlantButton variant="secondary" disabled={!english.trim() || !japanese.trim()} onClick={addWord}>
        {editIndex === null ? "＋ 追加" : "＋ 修正を反映"}
      </SlantButton>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {draft.words.map((w, i) => (
          <li key={i} className="panel-cut" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <button
              type="button"
              className="link-button"
              style={{ color: "var(--text)", textDecoration: "none", textAlign: "left", flex: 1 }}
              onClick={() => edit(i)}
              aria-label={`${w.english} ${w.japanese} を修正`}
            >
              <b>{w.english}</b> <span className="muted">{w.japanese}</span>
            </button>
            <button type="button" className="link-button" onClick={() => remove(i)} aria-label={`${w.english} を削除`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <SlantButton disabled={withPending().length === 0 || saving} onClick={() => void save()}>
        保存して完了
      </SlantButton>
      <AbandonButton />
    </>
  );
}
