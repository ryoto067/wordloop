import type { ReactNode } from "react";

export function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-cut" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: "0.875rem" }}>{label}</span>
      <span className="num-italic" style={{ fontSize: "1.375rem" }}>{children}</span>
    </div>
  );
}
