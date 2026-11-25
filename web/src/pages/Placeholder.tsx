// 後続タスクで各画面に置き換える仮ページ
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <div className="tag">COMING SOON</div>
      <h1>{title}</h1>
      <p className="muted">この画面は準備中です。</p>
    </>
  );
}
