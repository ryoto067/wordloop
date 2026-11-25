export class OfflineError extends Error {
  constructor() {
    super("オフラインです");
    this.name = "OfflineError";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new OfflineError();
  }
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401) {
    if (location.pathname !== "/login") location.assign("/login");
    throw new ApiError(401, body);
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
