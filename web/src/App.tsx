import { useEffect } from "react";
import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { BottomNav } from "./components/BottomNav";
import { useMe } from "./lib/useMe";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Placeholder } from "./pages/Placeholder";
import { Privacy } from "./pages/Privacy";
import { Terms } from "./pages/Terms";

// ログイン必須の画面。未ログインなら /login へ
function Protected() {
  const { me, loading } = useMe();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!loading && !me) location.assign("/login");
  }, [loading, me]);
  const showNav = ["/", "/review", "/sentences", "/records", "/settings"].includes(pathname);
  return (
    <div className={`app-shell ${showNav ? "" : "no-nav"}`}>
      <Outlet />
      {showNav && <BottomNav />}
    </div>
  );
}

const page = (title: string) => <Placeholder title={title} />;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/install" element={page("ホーム画面に追加")} />
        <Route element={<Protected />}>
          <Route path="/" element={<Home />} />
          <Route path="/round/start" element={page("暗記スタート")} />
          <Route path="/round/timer" element={page("暗記タイマー")} />
          <Route path="/round/entry" element={page("単語の登録")} />
          <Route path="/round/test" element={page("テスト")} />
          <Route path="/review" element={page("復習")} />
          <Route path="/sentences" element={page("文章")} />
          <Route path="/sentences/review" element={page("文章の復習")} />
          <Route path="/records" element={page("記録")} />
          <Route path="/settings" element={page("設定")} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
