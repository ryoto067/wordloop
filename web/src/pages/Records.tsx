import { useCallback, useEffect, useState } from "react";
import { MarkedText } from "../components/MarkedText";
import { ApiError, OfflineError, api } from "../lib/api";
import { useMe } from "../lib/MeContext";

type Tab = "words" | "sets" | "calendar" | "mastered";
const TABS: { id: Tab; label: string }[] = [
  { id: "words", label: "単語" },
  { id: "sets", label: "セット" },
  { id: "calendar", label: "カレンダー" },
  { id: "mastered", label: "マスター文章" },
];

const loadError = (err: unknown) => (err instanceof OfflineError ? "オフラインのため読み込めません" : "読み込めませんでした");

export function Records() {
  const [tab, setTab] = useState<Tab>("words");
  return (
    <>
      <div className="tag">RECORDS</div>
      <h1>記録</h1>
      <div role="tablist" aria-label="記録の種類" className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            className={`seg ${tab === t.id ? "on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "words" && <WordsTab />}
      {tab === "sets" && <SetsTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "mastered" && <MasteredTab />}
    </>
  );
}

type Word = { id: string; english: string; japanese: string };

function WordsTab() {
  const [q, setQ] = useState("");
  const [words, setWords] = useState<Word[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ english: "", japanese: "" });

  const load = useCallback(async (query: string) => {
    try {
      setWords(await api<Word[]>(`/api/words?q=${encodeURIComponent(query)}`));
      setError(null);
    } catch (err) {
      setError(loadError(err));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const save = async (id: string) => {
    try {
      await api(`/api/words/${id}`, { method: "PATCH", body: JSON.stringify(draft) });
      setEditId(null);
      await load(q);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "同じ英単語がすでにあります" : "保存できませんでした");
    }
  };

  const remove = async (w: Word) => {
    try {
      const res = await api<{ ok?: boolean; usedInSentences?: number }>(`/api/words/${w.id}`, { method: "DELETE" });
      if (res.usedInSentences) {
        if (!window.confirm(`「${w.english}」は ${res.usedInSentences} 件の文章で使われています。単語だけ削除しますか？（文章は残ります）`)) return;
        await api(`/api/words/${w.id}?confirm=1`, { method: "DELETE" });
      }
      await load(q);
    } catch {
      setError("削除できませんでした");
    }
  };

  return (
    <section aria-label="単語一覧" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="field">
        <span className="muted">検索（英語・日本語）</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {words.length === 0 && !error && <p className="muted">該当する単語はありません</p>}
      <ul className="rec-list">
        {words.map((w) => (
          <li key={w.id} className="rec-item">
            {editId === w.id ? (
              <>
                <div className="field">
                  <input aria-label="英語" value={draft.english} onChange={(e) => setDraft({ ...draft, english: e.target.value })} />
                  <input aria-label="日本語" value={draft.japanese} onChange={(e) => setDraft({ ...draft, japanese: e.target.value })} />
                </div>
                <div className="rec-actions">
                  <button type="button" className="link-button" onClick={() => void save(w.id)}>
                    保存
                  </button>
                  <button type="button" className="link-button" onClick={() => setEditId(null)}>
                    キャンセル
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>{w.english}</strong>
                  <div className="muted">{w.japanese}</div>
                </div>
                <div className="rec-actions">
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`${w.english} を編集`}
                    onClick={() => {
                      setEditId(w.id);
                      setDraft({ english: w.english, japanese: w.japanese });
                    }}
                  >
                    編集
                  </button>
                  <button type="button" className="link-button" aria-label={`${w.english} を削除`} onClick={() => void remove(w)}>
                    削除
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type WordSet = { id: string; name: string; wordCount: number; lastRoundNo: number };
type Round = { roundNo: number; startedAt: string; durationSec: number; remembered: number; forgot: number };

const fmtDuration = (s: number) => `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;

function SetsTab() {
  const [sets, setSets] = useState<WordSet[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rounds, setRounds] = useState<Record<string, Round[]>>({});

  useEffect(() => {
    api<WordSet[]>("/api/sets").then(setSets, (e) => setError(loadError(e)));
  }, []);

  const toggle = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    if (rounds[id]) return;
    try {
      const r = await api<Round[]>(`/api/sets/${id}/rounds`);
      setRounds((prev) => ({ ...prev, [id]: r }));
    } catch (err) {
      setError(loadError(err));
    }
  };

  return (
    <section aria-label="セット一覧" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {sets.length === 0 && !error && <p className="muted">まだセットがありません</p>}
      <ul className="rec-list">
        {sets.map((s) => (
          <li key={s.id} className="rec-item col">
            <button type="button" className="rec-head" aria-expanded={open === s.id} onClick={() => void toggle(s.id)}>
              <span>
                <strong>{s.name}</strong>
                <span className="muted"> ・ {s.wordCount} 語 ・ {s.lastRoundNo} 周</span>
              </span>
              <span aria-hidden="true">{open === s.id ? "▲" : "▼"}</span>
            </button>
            {open === s.id && (
              <ul className="round-list">
                {(rounds[s.id] ?? []).map((r) => (
                  <li key={r.roundNo}>
                    <strong>{r.roundNo} 周目</strong> {new Date(r.startedAt).toLocaleDateString("ja-JP")} ・ {fmtDuration(r.durationSec)}
                    {r.roundNo > 1 && (
                      <span>
                        {" "}
                        ・ 覚えた {r.remembered} / 忘れた {r.forgot}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Day = { date: string; achieved: boolean };

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}年${Number(m)}月`;
}
export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function CalendarTab() {
  const { me } = useMe();
  const todayStr = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: me?.timezone ?? "Asia/Tokyo" }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  })();
  const [month, setMonth] = useState(todayStr.slice(0, 7));
  const [days, setDays] = useState<Day[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Day[]>(`/api/activity?month=${month}`).then(
      (d) => {
        if (!alive) return;
        setDays(d);
        setError(null);
      },
      (e) => alive && setError(loadError(e)),
    );
    return () => {
      alive = false;
    };
  }, [month]);

  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const achieved = new Set(days.filter((d) => d.achieved).map((d) => d.date));
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];

  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <section aria-label="連続日数カレンダー" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="cal-head">
        <button type="button" className="link-button" aria-label="前の月" onClick={() => setMonth(shiftMonth(month, -1))}>
          ◀
        </button>
        <strong>{monthLabel(month)}</strong>
        <button type="button" className="link-button" aria-label="次の月" onClick={() => setMonth(shiftMonth(month, 1))}>
          ▶
        </button>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="cal-grid" role="table" aria-label={monthLabel(month)}>
        <div className="cal-row" role="row">
          {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
            <div key={w} className="cal-dow muted" role="columnheader">
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="cal-row" role="row">
            {week.map((d, i) => {
          if (d === null) return <div key={`e${i}`} role="cell" />;
          const date = `${month}-${String(d).padStart(2, "0")}`;
          const ok = achieved.has(date);
          return (
            <div
              key={date}
              role="cell"
              className={`cal-day ${ok ? "ok" : ""} ${date === todayStr ? "today" : ""}`}
              aria-label={`${m}月${d}日${ok ? " 達成" : ""}${date === todayStr ? " 今日" : ""}`}
            >
              <span>{d}</span>
              {ok && <span aria-hidden="true">✓</span>}
            </div>
          );
            })}
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        ✓ の日は、暗記の周回・復習の全消化・20 件以上の復習のどれかを達成した日です
      </p>
    </section>
  );
}

type Sentence = { id: string; englishMarked: string; japanese: string };

function MasteredTab() {
  const [list, setList] = useState<Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Sentence[]>("/api/sentences?status=mastered").then(setList, (e) => setError(loadError(e)));
  }, []);
  return (
    <section aria-label="マスターした文章" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {list && list.length === 0 && <p className="muted">まだマスターした文章はありません</p>}
      <ul className="story-list">
        {(list ?? []).map((s) => (
          <li key={s.id} className="story-card">
            <p className="story-text" style={{ fontSize: "1rem" }}>
              <MarkedText value={s.englishMarked} />
            </p>
            <p className="story-ja">{s.japanese}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
