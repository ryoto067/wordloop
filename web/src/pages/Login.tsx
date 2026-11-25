import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { SlantButton } from "../components/SlantButton";
import { ApiError, OfflineError, api } from "../lib/api";

const ERRORS: Record<string, string> = {
  denied: "ログインがキャンセルされました",
  failed: "ログインに失敗しました。もう一度お試しください",
};

export function Login() {
  const [params] = useSearchParams();
  const errorCode = params.get("error");
  const [email, setEmail] = useState("");
  const [devError, setDevError] = useState("");

  async function devLogin(e: FormEvent) {
    e.preventDefault();
    setDevError("");
    try {
      await api("/api/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) });
      location.assign("/");
    } catch (err) {
      setDevError(err instanceof OfflineError ? "API に接続できません" : err instanceof ApiError ? `失敗 (${err.status})` : "失敗しました");
    }
  }

  return (
    <main className="app-shell no-nav" style={{ justifyContent: "center" }}>
      <div className="tag">ENGLISH WORD TRAINER</div>
      <h1 className="num-italic" style={{ fontSize: "3rem" }}>WordLoop</h1>
      <p>紙の単語帳の英単語を、何度も回して確実に覚えるアプリ。</p>
      {errorCode && ERRORS[errorCode] && (
        <p role="alert" className="notice">
          {ERRORS[errorCode]}
        </p>
      )}
      <SlantButton type="button" onClick={() => location.assign("/api/auth/google")}>
        Google でログイン
      </SlantButton>
      <p className="muted" style={{ fontSize: "0.8125rem" }}>
        ログインすると <a href="/terms">利用規約</a> と <a href="/privacy">プライバシーポリシー</a> に同意したものとみなします。
      </p>
      {import.meta.env.DEV && (
        <form onSubmit={devLogin} className="field" style={{ marginTop: 24 }}>
          <label htmlFor="dev-email" className="muted" style={{ fontSize: "0.8125rem" }}>
            開発用ログイン
          </label>
          <input id="dev-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dev@example.com" />
          <SlantButton type="submit" variant="secondary">
            開発用ログインで入る
          </SlantButton>
          {devError && <span role="alert">{devError}</span>}
        </form>
      )}
    </main>
  );
}
