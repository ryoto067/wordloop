import type { ReactNode } from "react";
import { Link } from "react-router";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="app-shell no-nav">
      <div className="tag">WORDLOOP</div>
      <h1>{title}</h1>
      {children}
      <p className="muted" style={{ fontSize: "0.8125rem" }}>
        制定日: 2026年11月25日
      </p>
      <Link to="/login">ログイン画面へ戻る</Link>
    </main>
  );
}
