import { Link } from "react-router";
import { Panel } from "../components/Panel";
import { SlantLink } from "../components/SlantButton";
import { StreakNumber } from "../components/StreakNumber";
import { useMe } from "../lib/MeContext";
import { loadDraft, resumePath } from "../lib/roundDraft";

export function Home() {
  const { me } = useMe();
  if (!me) return <p className="muted">読み込み中…</p>;
  const draft = loadDraft();
  const { dueWords, dueSentences, waitingWords } = me.today;
  return (
    <>
      <div style={{ textAlign: "right" }}>
        <Link to="/settings" aria-label="設定" style={{ fontSize: "1.5rem", textDecoration: "none" }}>
          ⚙
        </Link>
      </div>
      <StreakNumber days={me.streak} />
      <Link to="/review" style={{ color: "inherit", textDecoration: "none" }}>
        <Panel label="単語の復習">{dueWords}</Panel>
      </Link>
      <Link to="/sentences" style={{ color: "inherit", textDecoration: "none" }}>
        <Panel label="文章の復習">{dueSentences}</Panel>
      </Link>
      {waitingWords >= 10 && (
        <Link to="/sentences" className="banner" style={{ textDecoration: "none" }}>
          文章にできる単語が {waitingWords} 語たまりました
        </Link>
      )}
      {draft ? (
        <SlantLink to={resumePath(draft)}>▶ 周回を再開</SlantLink>
      ) : (
        <SlantLink to="/round/start">▶ 暗記スタート</SlantLink>
      )}
    </>
  );
}
