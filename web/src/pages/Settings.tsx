import { useState } from "react";
import { Link } from "react-router";
import { IntervalEditor } from "../components/IntervalEditor";
import { NotifySection } from "../components/NotifySection";
import { SlantButton } from "../components/SlantButton";
import { api } from "../lib/api";
import { clearUserData, useMe } from "../lib/MeContext";

const FONTS = [
  { label: "小", value: 0.9 },
  { label: "中", value: 1 },
  { label: "大", value: 1.15 },
];
const BASE_ZONES = [
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export function timezoneOptions(current: string, browser: string): string[] {
  return [...new Set([current, browser, ...BASE_ZONES].filter(Boolean))];
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

export function Settings() {
  const { me, refresh } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState<number | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  if (!me) return null;

  const patch = (body: object) => api("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch {
      setError("保存できませんでした。接続を確認してもう一度お試しください");
    }
  };
  const font = fontScale ?? me.fontScale;

  const logout = async () => {
    setLoggingOut(true);
    await clearUserData();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.assign("/login");
  };

  return (
    <>
      <div className="tag">SETTINGS</div>
      <h1>設定</h1>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <NotifySection />

      <IntervalEditor label="単語の復習間隔" initial={me.wordIntervals} onSave={(v) => patch({ wordIntervals: v }).then(refresh)} />
      <IntervalEditor label="文章の復習間隔" initial={me.sentenceIntervals} onSave={(v) => patch({ sentenceIntervals: v }).then(refresh)} />

      <fieldset className="set-group">
        <legend>文字サイズ</legend>
        <div className="two-buttons">
          {FONTS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`seg ${font === f.value ? "on" : ""}`}
              aria-pressed={font === f.value}
              onClick={() => {
                setFontScale(f.value);
                document.documentElement.style.setProperty("--font-scale", String(f.value));
                void run(() => patch({ fontScale: f.value }));
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field set-group">
        <span>タイムゾーン</span>
        <select value={me.timezone} onChange={(e) => void run(() => patch({ timezone: e.target.value }))}>
          {timezoneOptions(me.timezone, browserTimezone()).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      <SlantButton variant="secondary" disabled={loggingOut} onClick={() => void logout()}>
        ログアウト
      </SlantButton>
      <p style={{ display: "flex", gap: 16, margin: 0 }}>
        <Link to="/privacy">プライバシーポリシー</Link>
        <Link to="/terms">利用規約</Link>
      </p>
    </>
  );
}
