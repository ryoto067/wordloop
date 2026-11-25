import { useNavigate } from "react-router";
import { clearDraft } from "../lib/roundDraft";

// 周回の途中でやめる。確認のうえ下書きを捨ててホームへ戻る
export function AbandonButton({ label = "やめる" }: { label?: string }) {
  const navigate = useNavigate();
  const abandon = () => {
    if (!window.confirm("この周回を破棄しますか？入力した単語は保存されません")) return;
    clearDraft();
    navigate("/", { replace: true });
  };
  return (
    <button type="button" className="link-button" onClick={abandon}>
      {label}
    </button>
  );
}
