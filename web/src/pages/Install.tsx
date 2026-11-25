import { useState } from "react";
import { Link } from "react-router";
import { SlantButton } from "../components/SlantButton";
import { enablePush, isStandalone, needsInstall, pushSupported } from "../lib/push";

const STEPS = [
  { n: 1, title: "Safari で WordLoop を開く", body: "Chrome など他のアプリでは、ホーム画面に追加できないことがあります。" },
  { n: 2, title: "画面下の「共有」ボタンをタップ", body: "四角から上向きの矢印が出ているアイコン（□↑）です。" },
  { n: 3, title: "「ホーム画面に追加」を選ぶ", body: "メニューを下にスクロールすると見つかります。" },
  { n: 4, title: "右上の「追加」をタップ", body: "ホーム画面に WordLoop のアイコンができます。" },
  { n: 5, title: "ホーム画面のアイコンから開く", body: "開いたら、設定から「通知を許可する」を押してください。" },
];

export function Install() {
  const [result, setResult] = useState<string | null>(null);
  const installed = isStandalone();
  const mustInstall = needsInstall();

  const allow = async () => {
    try {
      setResult((await enablePush()) === "on" ? "通知をオンにしました" : "通知が許可されませんでした。端末の設定から変更できます");
    } catch {
      setResult("うまくいきませんでした。接続を確認してもう一度お試しください");
    }
  };

  return (
    <>
      <div className="tag">INSTALL</div>
      <h1>ホーム画面に追加</h1>
      {installed ? (
        <>
          <p>インストール済みです。復習の時間に通知を受け取れます。</p>
          {pushSupported() ? (
            <SlantButton onClick={() => void allow()}>通知を許可する</SlantButton>
          ) : (
            <p className="notice">このブラウザは通知に未対応です</p>
          )}
          {result && (
            <p role="status" className="notice">
              {result}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            iPhone では、ホーム画面に追加すると通知が使え、アプリのように開けます（iOS 16.4 以上）。
          </p>
          {!mustInstall && <p className="notice">この端末のブラウザでは、メニューの「インストール」または「ホーム画面に追加」からも追加できます。</p>}
          <ol className="install-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="panel-cut">
                <span className="num-italic install-n" aria-hidden="true">
                  {s.n}
                </span>
                <div>
                  <strong>{s.title}</strong>
                  <p className="muted" style={{ margin: 0 }}>
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <Link to="/">ホームへ戻る</Link>
    </>
  );
}
