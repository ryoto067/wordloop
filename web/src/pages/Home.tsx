import { Link } from "react-router";
import { Panel } from "../components/Panel";
import { SlantLink } from "../components/SlantButton";
import { StreakNumber } from "../components/StreakNumber";
import { useMe } from "../lib/MeContext";

// 仮のホーム。後続タスクで本実装に置き換える
export function Home() {
  const { me } = useMe();
  if (!me) return <p className="muted">読み込み中…</p>;
  return (
    <>
      <div style={{ textAlign: "right" }}>
        <Link to="/settings">設定</Link>
      </div>
      <StreakNumber days={me.streak} />
      <Panel label="単語の復習">{me.today.dueWords}</Panel>
      <Panel label="文章の復習">{me.today.dueSentences}</Panel>
      <SlantLink to="/round/start">▶ 暗記スタート</SlantLink>
    </>
  );
}
