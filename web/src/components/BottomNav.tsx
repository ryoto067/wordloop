import { NavLink } from "react-router";

const items = [
  { to: "/", label: "ホーム", end: true },
  { to: "/review", label: "復習", end: false },
  { to: "/sentences", label: "文章", end: false },
  { to: "/records", label: "記録", end: false },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="メインメニュー">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
