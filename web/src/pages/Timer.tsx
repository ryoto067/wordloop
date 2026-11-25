import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AbandonButton } from "../components/AbandonButton";
import { SlantButton } from "../components/SlantButton";
import { OfflineError, api } from "../lib/api";
import { elapsedSec, formatTime, loadDraft, saveDraft, type DraftWord, type RoundDraft } from "../lib/roundDraft";
import { keepAwake } from "../lib/wakeLock";

export function roundLabel(d: RoundDraft): string {
  const n = String(d.roundNo).padStart(2, "0");
  return d.mode === "first" ? `ROUND ${n}` : `SET ${d.setName ?? ""} ・ ROUND ${n}`;
}

export function Timer() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(loadDraft);
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stopped = !!draft?.stoppedAt;
  const paused = !!draft?.pausedAt;

  useEffect(() => {
    if (stopped) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [stopped]);

  useEffect(() => {
    if (stopped || paused) return;
    return keepAwake();
  }, [stopped, paused]);

  const update = useCallback((d: RoundDraft) => {
    saveDraft(d);
    setDraft(d);
  }, []);

  const startTest = useCallback(
    async (d: RoundDraft) => {
      if (!d.setId) return;
      setStarting(true);
      setMessage(null);
      try {
        const res = await api<{ roundId: string; words: { id: string; english: string; japanese: string }[] }>("/api/rounds/next", {
          method: "POST",
          body: JSON.stringify({
            setId: d.setId,
            roundNo: d.roundNo,
            startedAt: d.startedAt,
            durationSec: elapsedSec(d, Date.now()),
          }),
        });
        const words: DraftWord[] = res.words;
        saveDraft({ ...d, roundId: res.roundId, words });
        navigate("/round/test", { replace: true });
      } catch (err) {
        setMessage(err instanceof OfflineError ? "オンラインになったらテストを始められます" : "テストを始められませんでした。もう一度お試しください");
        setStarting(false);
      }
    },
    [navigate],
  );

  if (!draft) return <Navigate to="/" replace />;
  if (draft.mode === "first" && stopped) return <Navigate to="/round/entry" replace />;
  if (draft.roundId) return <Navigate to="/round/test" replace />;

  const toggle = () => {
    if (stopped) return;
    if (draft.pausedAt) {
      update({ ...draft, pausedMs: draft.pausedMs + (Date.now() - Date.parse(draft.pausedAt)), pausedAt: undefined });
    } else {
      update({ ...draft, pausedAt: new Date().toISOString() });
    }
  };

  const stop = () => {
    const t = Date.now();
    const base = draft.pausedAt ? { ...draft, pausedMs: draft.pausedMs + (t - Date.parse(draft.pausedAt)), pausedAt: undefined } : draft;
    const d = { ...base, stoppedAt: new Date(t).toISOString() };
    update(d);
    if (d.mode === "first") navigate("/round/entry", { replace: true });
    else void startTest(d);
  };

  const sec = elapsedSec(draft, now);
  return (
    <>
      <div className="tag">{roundLabel(draft)}</div>
      {stopped ? (
        <>
          <div className="num-italic" style={{ fontSize: "4.5rem", textAlign: "center", marginTop: 40 }}>
            {formatTime(sec)}
          </div>
          <p role="status" className="notice">
            {message ?? "テストを準備しています…"}
          </p>
          <SlantButton disabled={starting} onClick={() => void startTest(draft)}>
            もう一度ためす
          </SlantButton>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-label={paused ? "再開する" : "一時停止する"}
            style={{ flex: 1, background: "none", border: 0, color: "var(--text)", font: "inherit", cursor: "pointer", minHeight: 260 }}
          >
            <span className="num-italic" style={{ fontSize: "5rem", display: "block" }} data-testid="timer">
              {formatTime(sec)}
            </span>
            <span className="muted" style={{ display: "block", marginTop: 12 }}>
              {paused ? "一時停止中（タップで再開）" : "タップで一時停止"}
            </span>
          </button>
          <SlantButton style={{ background: "var(--orange)" }} onClick={stop}>
            STOP
          </SlantButton>
        </>
      )}
      <AbandonButton />
    </>
  );
}
