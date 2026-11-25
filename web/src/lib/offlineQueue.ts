import { del, get, set } from "idb-keyval";
import { ApiError, OfflineError, api } from "./api";

export type QueuedRequest = {
  id: string;
  path: string;
  body: unknown;
  kind: "reviews" | "other";
};

export type FlushResult = { streak?: number };
export type Send = (path: string, body: unknown) => Promise<unknown>;

const KEY = "wl_offline_queue";
const OWNER_KEY = "wl_queue_owner";
// D1 の 1 回あたりの上限に収まるよう、復習は 15 件ずつ送る
const REVIEW_CHUNK = 15;

const defaultSend: Send = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });

// 読み書きの競合を避けるため、キューの変更は 1 つずつ順に行う
let lock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

async function read(): Promise<QueuedRequest[]> {
  return (await get<QueuedRequest[]>(KEY)) ?? [];
}

export function list(): Promise<QueuedRequest[]> {
  return locked(read);
}

export async function size(): Promise<number> {
  return (await list()).length;
}

export function enqueue(item: QueuedRequest): Promise<void> {
  return locked(async () => {
    await set(KEY, [...(await read()), item]);
  });
}

// キューに残っていて取り除けたら true
export function removeFromQueue(id: string): Promise<boolean> {
  return locked(async () => {
    const items = await read();
    const rest = items.filter((i) => i.id !== id);
    if (rest.length === items.length) return false;
    await set(KEY, rest);
    return true;
  });
}

function removeMany(ids: string[]): Promise<void> {
  return locked(async () => {
    const gone = new Set(ids);
    await set(KEY, (await read()).filter((i) => !gone.has(i.id)));
  });
}

export function clearQueue(): Promise<void> {
  return locked(() => del(KEY));
}

export function clearQueueOwner(): Promise<void> {
  return del(OWNER_KEY);
}

// キューの持ち主。別のアカウントでログインしたら前の人の送信待ちは捨てる
// （同じ人のセッション切れでは残す）。キューを捨てたら true
export async function claimQueue(userId: string): Promise<boolean> {
  try {
    const owner = await get<string>(OWNER_KEY);
    let cleared = false;
    if (owner && owner !== userId) {
      await clearQueue();
      cleared = true;
    }
    if (owner !== userId) await set(OWNER_KEY, userId);
    return cleared;
  } catch {
    return false;
  }
}

type Outcome = "sent" | "bad" | "stop";

// 送った内容そのものが悪いときの 4xx。これだけ破棄する（401/403/408/429/5xx は残して再送）
const BAD_ITEM = new Set([400, 404, 409, 422]);

async function attempt(send: Send, path: string, body: unknown, onResult: (r: unknown) => void): Promise<Outcome> {
  try {
    onResult(await send(path, body));
    return "sent";
  } catch (err) {
    if (err instanceof ApiError && BAD_ITEM.has(err.status)) {
      console.warn("offlineQueue: 不正な項目として判定されました", path, err.status);
      return "bad";
    }
    // OfflineError・認証切れ・5xx・その他は残して次回に回す
    if (!(err instanceof OfflineError)) console.warn("offlineQueue: 送信に失敗したため残します", path, err);
    return "stop";
  }
}

async function runFlush(send: Send): Promise<FlushResult> {
  const result: FlushResult = {};
  const onResult = (r: unknown) => {
    const streak = (r as { streak?: unknown } | null)?.streak;
    if (typeof streak === "number") result.streak = streak;
  };
  const items = await list();

  const reviews = items.filter((i) => i.kind === "reviews");
  for (let i = 0; i < reviews.length; i += REVIEW_CHUNK) {
    const chunk = reviews.slice(i, i + REVIEW_CHUNK);
    const outcome = await attempt(send, chunk[0].path, { items: chunk.map((c) => c.body) }, onResult);
    if (outcome === "stop") return result;
    if (outcome === "sent" || chunk.length === 1) {
      await removeMany(chunk.map((c) => c.id));
      continue;
    }
    // まとめて弾かれたら 1 件ずつ送り直し、悪い項目だけ捨てる
    for (const item of chunk) {
      const single = await attempt(send, item.path, { items: [item.body] }, onResult);
      if (single === "stop") return result;
      await removeMany([item.id]);
    }
  }
  for (const item of items.filter((i) => i.kind === "other")) {
    const outcome = await attempt(send, item.path, item.body, onResult);
    if (outcome === "stop") return result;
    await removeMany([item.id]);
  }
  return result;
}

let running: Promise<FlushResult> | null = null;

// 同時に 2 回走らせない。実行中に呼ばれたら、終わってからもう一度流す
export function flush(send: Send = defaultSend): Promise<FlushResult> {
  if (running) return running.then(() => flush(send));
  const p = runFlush(send).finally(() => {
    running = null;
  });
  running = p;
  return p;
}

let started = false;
// 起動時と回線復帰時に flush する（何度呼んでも 1 回だけ登録）
export function startAutoFlush(): void {
  if (started) return;
  started = true;
  const run = () => void flush().catch((err) => console.warn("offlineQueue: flush に失敗しました", err));
  run();
  window.addEventListener("online", run);
}
