import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";
import { FlashCard } from "../components/FlashCard";
import { SlantButton, SlantLink } from "../components/SlantButton";
import { api } from "../lib/api";
import { useMe } from "../lib/MeContext";
import { clearDraft, loadDraft } from "../lib/roundDraft";

type Result = "remembered" | "forgot";
type Summary = { remembered: number; forgot: number };

export function RoundTest() {
  const { refresh } = useMe();
  const [draft] = useState(loadDraft);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<{ wordId: string; result: Result }[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sent = useRef(false);

  const words = draft?.words ?? [];
  const finished = results.length >= words.length && words.length > 0;

  const submit = async () => {
    if (!draft?.roundId || sending) return;
    setSending(true);
    setFailed(false);
    try {
      const r = await api<Summary>(`/api/rounds/${draft.roundId}/results`, { method: "POST", body: JSON.stringify({ results }) });
      clearDraft();
      setSummary(r);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (finished && !sent.current) {
      sent.current = true;
      void submit();
    }
    // 最後の 1 枚に答えたときに 1 回だけ送る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (summary) {
    return (
      <>
        <div className="tag">COMPLETE</div>
        <h1>テスト完了！</h1>
        <div className="panel-cut" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>覚えてた</span>
          <span className="num-italic" style={{ fontSize: "1.5rem" }}>
            {summary.remembered}
          </span>
        </div>
        <div className="panel-cut" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>忘れてた</span>
          <span className="num-italic" style={{ fontSize: "1.5rem" }}>
            {summary.forgot}
          </span>
        </div>
        <SlantLink to="/">ホームへ</SlantLink>
      </>
    );
  }

  if (!draft || !draft.roundId || words.length === 0) return <Navigate to="/" replace />;

  if (finished) {
    return (
      <>
        <div className="tag">SAVING</div>
        {failed ? (
          <>
            <p role="alert" className="notice">
              結果を送れませんでした。つながったらもう一度ためしてください
            </p>
            <SlantButton disabled={sending} onClick={() => void submit()}>
              もう一度送る
            </SlantButton>
          </>
        ) : (
          <p className="muted">結果を保存しています…</p>
        )}
      </>
    );
  }

  const word = words[index];
  const answer = (result: Result) => {
    if (!word.id) return;
    setResults((r) => [...r, { wordId: word.id as string, result }]);
    setIndex((i) => i + 1);
  };
  return (
    <>
      <div className="tag">
        TEST ・ {index + 1} / {words.length}
      </div>
      <div className="progress" role="progressbar" aria-label="進み具合" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={index}>
        <div style={{ width: `${(index / words.length) * 100}%` }} />
      </div>
      <FlashCard key={word.id} front={word.english} back={word.japanese} onResult={answer} />
    </>
  );
}
