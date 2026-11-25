import { BrowserRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { BottomNav } from "./components/BottomNav";
import { MeProvider, useMe } from "./lib/MeContext";
import { Entry } from "./pages/Entry";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Placeholder } from "./pages/Placeholder";
import { Privacy } from "./pages/Privacy";
import { Review } from "./pages/Review";
import { SentenceReview } from "./pages/SentenceReview";
import { Sentences } from "./pages/Sentences";
import { RoundStart } from "./pages/RoundStart";
import { RoundTest } from "./pages/RoundTest";
import { Terms } from "./pages/Terms";
import { Timer } from "./pages/Timer";

// ログイン必須の画面。未ログイン(401)のときは api() が /login へ遷移させる
export function ProtectedLayout() {
  const { me, status, refresh } = useMe();
  const { pathname } = useLocation();
  const showNav = ["/", "/review", "/sentences", "/records", "/settings"].includes(pathname);
  return (
    <div className={`app-shell ${showNav ? "" : "no-nav"}`}>
      {status === "offline" && (
        <p role="status" className="banner">
          オフラインです。つながると自動で同期します
        </p>
      )}
      {status === "error" ? (
        <div role="alert" className="notice">
          <p>読み込めませんでした。</p>
          <button type="button" className="btn-slant slant secondary" onClick={refresh}>
            再読み込み
          </button>
        </div>
      ) : me ? (
        <Outlet />
      ) : (
        <p className="muted">読み込み中…</p>
      )}
      {showNav && <BottomNav />}
    </div>
  );
}

function Protected() {
  return (
    <MeProvider>
      <ProtectedLayout />
    </MeProvider>
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
          <Route path="/round/start" element={<RoundStart />} />
          <Route path="/round/timer" element={<Timer />} />
          <Route path="/round/entry" element={<Entry />} />
          <Route path="/round/test" element={<RoundTest />} />
          <Route path="/review" element={<Review />} />
          <Route path="/sentences" element={<Sentences />} />
          <Route path="/sentences/review" element={<SentenceReview />} />
          <Route path="/records" element={page("記録")} />
          <Route path="/settings" element={page("設定")} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
