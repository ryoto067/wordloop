export interface Env {
  DB: D1Database;
  AI: Ai;
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  AI_PROVIDER?: "workers-ai" | "claude";
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  DEV_LOGIN?: "1";
}

export type AppEnv = { Bindings: Env; Variables: { userId: string } };
