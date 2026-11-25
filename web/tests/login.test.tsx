import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "../src/pages/Login";

const assign = vi.fn();

function renderLogin(search = "") {
  vi.stubGlobal("location", { assign, pathname: "/login" });
  render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Login />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("Login", () => {
  it("Google でログインは /api/auth/google へ全画面遷移する", () => {
    renderLogin();
    fireEvent.click(screen.getByRole("button", { name: "Google でログイン" }));
    expect(assign).toHaveBeenCalledWith("/api/auth/google");
  });

  it.each([
    ["denied", "ログインがキャンセルされました"],
    ["failed", "ログインに失敗しました。もう一度お試しください"],
  ])("?error=%s で日本語メッセージを出す", (code, message) => {
    renderLogin(`?error=${code}`);
    expect(screen.getByRole("alert").textContent).toBe(message);
  });

  it("エラーなしならメッセージを出さない", () => {
    renderLogin();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
