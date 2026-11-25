import { useState } from "react";
import { validateIntervals } from "../lib/intervals";
import { SlantButton } from "./SlantButton";

type Props = { label: string; initial: number[]; onSave(values: number[]): Promise<void> };

export function IntervalEditor({ label, initial, onSave }: Props) {
  const [values, setValues] = useState(initial.map(String));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const error = validateIntervals(values);

  const change = (i: number, v: string) => {
    setValues(values.map((x, j) => (j === i ? v : x)));
    setMessage(null);
  };
  const save = async () => {
    if (error) return;
    setBusy(true);
    try {
      await onSave(values.map(Number));
      setMessage({ ok: true, text: "保存しました" });
    } catch {
      setMessage({ ok: false, text: "保存できませんでした。接続を確認してもう一度お試しください" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="set-group">
      <legend>{label}</legend>
      <p className="muted" style={{ margin: 0 }}>
        各段階で「何日後に復習するか」です
      </p>
      <ol className="interval-list">
        {values.map((v, i) => (
          <li key={i}>
            <label>
              <span>{i + 1} 段階目</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                value={v}
                aria-label={`${label} ${i + 1} 段階目の日数`}
                onChange={(e) => change(i, e.target.value)}
              />
              <span>日後</span>
            </label>
            <button
              type="button"
              className="link-button"
              disabled={values.length <= 1}
              aria-label={`${label} ${i + 1} 段階目を削除`}
              onClick={() => {
                setValues(values.filter((_, j) => j !== i));
                setMessage(null);
              }}
            >
              削除
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="link-button"
        disabled={values.length >= 8}
        onClick={() => {
          const last = Number(values[values.length - 1]);
          setValues([...values, String(Number.isInteger(last) ? Math.min(365, last + 30) : 30)]);
          setMessage(null);
        }}
      >
        ＋ 段階を追加
      </button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className="notice">
          {message.text}
        </p>
      )}
      <SlantButton variant="secondary" disabled={!!error || busy} onClick={() => void save()}>
        保存
      </SlantButton>
    </fieldset>
  );
}
