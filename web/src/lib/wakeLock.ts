// 画面のスリープを防ぐ。非対応の端末では何もしない。戻り値で解除する
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let active = true;

  const acquire = async () => {
    try {
      if (!active || !navigator.wakeLock || document.visibilityState !== "visible") return;
      const l = await navigator.wakeLock.request("screen");
      if (!active) void l.release().catch(() => {});
      else lock = l;
    } catch {
      // 非対応・拒否は無視する
    }
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void acquire();
  };

  void acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => {});
    lock = null;
  };
}
