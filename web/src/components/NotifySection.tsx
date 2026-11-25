import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { currentSubscription, disablePush, enablePush, needsInstall, pushSupported } from "../lib/push";
import { SlantButton } from "./SlantButton";

type NotifyTime = { id: string; hhmm: string; kind: string };
type Status = "on" | "off" | "denied" | "unsupported";

const LABELS: Record<Status, string> = {
  on: "オン",
  off: "オフ",
  denied: "オフ（ブラウザの設定で通知がブロックされています）",
  unsupported: "このブラウザは未対応です",
};

export function NotifySection() {
  const [status, setStatus] = useState<Status>("off");
  const [times, setTimes] = useState<NotifyTime[]>([]);
  const [newTime, setNewTime] = useState("20:00");
  const [error, setError] = useState<string | null>(null);
  const install = needsInstall();

  const loadStatus = useCallback(async () => {
    if (!pushSupported()) return setStatus("unsupported");
    if (Notification.permission === "denied") return setStatus("denied");
    const sub = await currentSubscription().catch(() => null);
    setStatus(sub && Notification.permission === "granted" ? "on" : "off");
  }, []);
  const loadTimes = useCallback(async () => {
    try {
      setTimes(await api<NotifyTime[]>("/api/settings/notify-times"));
    } catch {
      setError("通知時刻を読み込めませんでした");
    }
  }, []);
  useEffect(() => {
    void loadStatus();
    void loadTimes();
  }, [loadStatus, loadTimes]);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch {
      setError("うまくいきませんでした。接続を確認してもう一度お試しください");
    }
  };

  const toggle = () =>
    guard(async () => {
      if (status === "on") await disablePush();
      else await enablePush();
      await loadStatus();
    });

  const testNotify = () =>
    guard(async () => {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification("WordLoop", { body: "テスト通知です", icon: "/icons/icon-192.png", data: { url: "/" } });
    });

  const changeTime = (t: NotifyTime, v: string) => {
    if (!v || v === t.hhmm) return;
    void guard(async () => {
      await api(`/api/settings/notify-times/${t.id}`, { method: "PATCH", body: JSON.stringify({ hhmm: v }) });
      await loadTimes();
    });
  };

  return (
    <section className="set-group" aria-label="通知">
      <h2>通知</h2>
      <p style={{ margin: 0 }}>
        状態: <strong>{LABELS[status]}</strong>
      </p>
      {install ? (
        <p className="notice">
          iPhone では「ホーム画面に追加」してから通知を使えます。<Link to="/install">追加のしかたを見る</Link>
        </p>
      ) : (
        status !== "unsupported" &&
        status !== "denied" && (
          <div className="two-buttons">
            <SlantButton variant={status === "on" ? "secondary" : "primary"} onClick={() => void toggle()}>
              {status === "on" ? "通知をオフにする" : "通知を許可する"}
            </SlantButton>
            {status === "on" && (
              <SlantButton variant="secondary" onClick={() => void testNotify()}>
                テスト通知
              </SlantButton>
            )}
          </div>
        )
      )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <h3 style={{ margin: "6px 0 0" }}>通知する時刻</h3>
      {times.length === 0 && <p className="muted">まだありません</p>}
      <ul className="time-list">
        {times.map((t) => (
          <li key={`${t.id}-${t.hhmm}`}>
            <input type="time" defaultValue={t.hhmm} aria-label="通知時刻" onChange={(e) => changeTime(t, e.target.value)} />
            <button
              type="button"
              className="link-button"
              aria-label={`${t.hhmm} の通知を削除`}
              onClick={() =>
                void guard(async () => {
                  await api(`/api/settings/notify-times/${t.id}`, { method: "DELETE" });
                  await loadTimes();
                })
              }
            >
              削除
            </button>
          </li>
        ))}
      </ul>
      <div className="time-add">
        <input type="time" value={newTime} aria-label="追加する時刻" onChange={(e) => setNewTime(e.target.value)} />
        <SlantButton
          variant="secondary"
          disabled={!newTime}
          onClick={() =>
            void guard(async () => {
              await api("/api/settings/notify-times", { method: "POST", body: JSON.stringify({ hhmm: newTime, kind: "custom" }) });
              await loadTimes();
            })
          }
        >
          追加
        </SlantButton>
      </div>
    </section>
  );
}
