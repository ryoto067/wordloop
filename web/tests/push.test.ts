import { afterEach, describe, expect, it, vi } from "vitest";
import { isIosSafariNotInstalled, subscribePush, urlBase64ToUint8Array } from "../src/lib/push";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

describe("isIosSafariNotInstalled", () => {
  it("iPhone Safari で未インストールなら true", () => {
    expect(isIosSafariNotInstalled(IPHONE, false)).toBe(true);
  });
  it("インストール済み（standalone）なら false", () => {
    expect(isIosSafariNotInstalled(IPHONE, true)).toBe(false);
  });
  it("Android Chrome は false", () => {
    expect(isIosSafariNotInstalled(ANDROID, false)).toBe(false);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("URL セーフ base64 をバイト列に変換する", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID-_8"))).toEqual([1, 2, 3, 251, 255]);
  });
});

describe("subscribePush", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("公開鍵で購読し、endpoint と keys を返す", async () => {
    const json = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
    const subscribe = vi.fn().mockResolvedValue({ toJSON: () => json });
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager: { subscribe } }) } });
    const sub = await subscribePush("AQID");
    expect(sub).toEqual(json);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
  });
});
