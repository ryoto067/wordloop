import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { SlantButton } from "../components/SlantButton";
import { OfflineError, api } from "../lib/api";
import { saveDraft } from "../lib/roundDraft";

type WordSet = { id: string; name: string; wordCount: number; lastRoundNo: number; createdAt: string };

export function RoundStart() {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<1 | 2 | 3 | 4>(1);
  const [fourth, setFourth] = useState(4);
  const [sets, setSets] = useState<WordSet[] | null>(null);
  const [setId, setSetId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const roundNo = choice === 4 ? Math.max(4, fourth) : choice;
  const needSet = roundNo >= 2;

  useEffect(() => {
    if (!needSet || sets) return;
    let alive = true;
    api<WordSet[]>("/api/sets")
      .then((list) => {
        if (!alive) return;
        const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // 直近が先頭
        setSets(sorted);
        setSetId(sorted[0]?.id ?? "");
      })
      .catch((err) => {
        if (alive) setError(err instanceof OfflineError ? "オフラインのため、セットを読み込めません" : "セットを読み込めませんでした");
      });
    return () => {
      alive = false;
    };
  }, [needSet, sets]);

  const start = () => {
    const set = sets?.find((s) => s.id === setId);
    if (needSet && !set) return;
    saveDraft({
      mode: needSet ? "next" : "first",
      setId: set?.id,
      setName: set?.name,
      roundNo,
      startedAt: new Date().toISOString(),
      pausedMs: 0,
      words: [],
    });
    navigate("/round/timer");
  };

  return (
    <>
      <div className="tag">START</div>
      <h1>何周目をやる？</h1>
      <div className="two-buttons" role="group" aria-label="周回">
        {([1, 2, 3, 4] as const).map((n) => (
          <SlantButton key={n} variant={choice === n ? "primary" : "secondary"} aria-pressed={choice === n} onClick={() => setChoice(n)}>
            {n === 4 ? "4〜" : `${n}周目`}
          </SlantButton>
        ))}
      </div>
      {choice === 4 && (
        <label className="field">
          <span>何周目？</span>
          <input type="number" min={4} value={fourth} onChange={(e) => setFourth(Number(e.target.value) || 4)} />
        </label>
      )}
      {needSet && (
        <>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {sets && sets.length === 0 && <p className="notice">まだセットがありません。1 周目から始めてください</p>}
          {sets && sets.length > 0 && (
            <label className="field">
              <span>セットを選ぶ</span>
              <select value={setId} onChange={(e) => setSetId(e.target.value)}>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}（{s.wordCount} 語・{s.lastRoundNo} 周済み）
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <SlantButton onClick={start} disabled={needSet && !setId}>
        ▶ スタート
      </SlantButton>
    </>
  );
}
