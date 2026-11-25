import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "../e2e-shots";
const email = `e2e-${Date.now()}@example.com`;

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

// SQL はファイル経由で渡す（シェルのクォート問題を避ける）
function d1(sql: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "wl-e2e-")), "q.sql");
  writeFileSync(file, sql);
  return execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--json", "--file", file], {
    cwd: "../api",
    encoding: "utf8",
    shell: true,
  });
}

const todayJst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());

function countReviews(): number {
  const out = JSON.parse(
    d1(`SELECT COUNT(*) AS n FROM word_reviews WHERE word_id IN (SELECT id FROM words WHERE user_id = (SELECT id FROM users WHERE email = '${email}'))`),
  );
  return out[0].results[0].n as number;
}

test("ログイン → 1周目 → 復習 → オフライン採点 → 送信", async ({ page, context }) => {
  // Login 画面
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "WordLoop" })).toBeVisible();
  await shot(page, "01-login");

  await page.getByLabel("開発用ログイン").fill(email);
  await page.getByRole("button", { name: "開発用ログインで入る" }).click();
  await expect(page.getByText("暗記スタート")).toBeVisible();
  await shot(page, "02-home-empty");

  // 1周目: タイマー 約3秒
  await page.getByRole("link", { name: /暗記スタート/ }).click();
  await shot(page, "03-round-start");
  await page.getByRole("button", { name: /スタート/ }).click();
  await expect(page.getByTestId("timer")).toBeVisible();
  await page.waitForTimeout(3200);
  await shot(page, "04-timer");
  await page.getByRole("button", { name: "STOP" }).click();

  // 入力: Enter で 英→日→確定。IME 変換中の Enter は送信しない
  await expect(page.getByText(/ENTRY/)).toBeVisible();
  const en = page.getByLabel("英単語");
  const ja = page.getByLabel("日本語訳");
  const words: [string, string][] = [["apple", "りんご"], ["borrow", "借りる"], ["candle", "ろうそく"]];
  for (const [e, j] of words) {
    await en.fill(e);
    await en.press("Enter");
    await expect(ja).toBeFocused();
    await ja.fill(j);
    if (e === "borrow") {
      // 変換確定の Enter(isComposing) は無視される
      await ja.evaluate((el) => {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
      });
      await expect(page.getByText("3 語目")).not.toBeVisible();
    }
    await ja.press("Enter");
    await expect(en).toBeFocused();
  }
  await expect(page.getByText("4 語目")).toBeVisible();
  await expect(page.getByText("apple")).toBeVisible();
  await shot(page, "05-entry");
  await page.getByRole("button", { name: "保存して完了" }).click();
  await expect(page.getByText("今日覚えた単語 3 語")).toBeVisible();
  await shot(page, "06-complete");
  await page.getByRole("link", { name: "ホームへ" }).click();

  // 日付を進めた状態を作る
  d1(`UPDATE words SET next_review_on = '${todayJst()}' WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
  await page.reload();
  await expect(page.getByText("単語の復習")).toBeVisible();
  await shot(page, "07-home-due");

  // 復習: めくる → 採点 → 1つ戻す
  await page.getByRole("link", { name: /単語の復習/ }).click();
  await expect(page.getByText("REVIEW ・ 1 / 3")).toBeVisible();
  await shot(page, "08-review-front");
  await page.locator(".flashcard").click();
  await expect(page.locator(".flashcard-meaning")).toBeVisible();
  await shot(page, "09-review-back");
  await page.getByRole("button", { name: "覚えてた" }).click();
  await expect(page.getByText("REVIEW ・ 2 / 3")).toBeVisible();
  await page.getByRole("button", { name: /1つ戻す/ }).click();
  await expect(page.getByText("REVIEW ・ 1 / 3")).toBeVisible();

  // オフラインで 1 枚採点
  await context.setOffline(true);
  await page.locator(".flashcard").click();
  await page.getByRole("button", { name: "覚えてた" }).click();
  await expect(page.getByText("REVIEW ・ 2 / 3")).toBeVisible();
  await shot(page, "10-review-offline");
  const before = countReviews();

  // オンラインに戻ると送信される
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(countReviews, { timeout: 20_000 }).toBe(before + 1);

  // 残りも採点して完了画面
  for (let i = 0; i < 2; i++) {
    await page.locator(".flashcard").click();
    await page.getByRole("button", { name: "覚えてた" }).click();
  }
  await shot(page, "11-review-done");

  // そのほかの画面
  for (const [path, name] of [["/sentences", "12-sentences"], ["/records", "13-records"], ["/settings", "14-settings"]] as const) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await shot(page, name);
  }
});
