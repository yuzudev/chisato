// The entry point: read the environment, start chisato, wait for signals.

import { Chisato } from "./bot";

const token = process.env.DUVET_BOT_TOKEN?.trim();
if (!token) {
  console.error(
    "DUVET_BOT_TOKEN is missing. Copy .env.example to .env and paste the bot token.",
  );
  process.exit(1);
}

const bot = new Chisato({
  token,
  shards: numberFromEnv("DUVET_SHARDS", 1),
  resume: booleanFromEnv("DUVET_RESUME", true),
  api: process.env.DUVET_API?.trim() || "api.duvet.chat",
  ws: process.env.DUVET_WS?.trim() || "ws.duvet.chat",
  secure: booleanFromEnv("DUVET_SECURE", true),
  timeoutMs: numberFromEnv("DUVET_TIMEOUT_MS", 20_000),
  log: (line) => console.error(`[chisato] ${line}`),
});

bot.gateway.on("close", (close) =>
  console.error(`[gateway:${close.shardId}] closed: ${close.code} ${close.reason}`),
);
bot.gateway.on("connectFailed", (failure) =>
  console.error(
    `[gateway:${failure.shardId}] connect failed (${failure.failures}): ${failure.error}`,
  ),
);
bot.gateway.on("resumed", (shard) => console.error(`[gateway:${shard}] resumed`));
bot.gateway.on("malformed", (message) =>
  console.error(`[gateway] malformed frame: ${message}`),
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.error(`[chisato] ${signal}: stopping`);
  try {
    await bot.stop();
  } catch (error) {
    console.error(`[chisato] stopping failed: ${errorText(error)}`);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await bot.start();
} catch (error) {
  console.error(`[chisato] couldn't start: ${errorText(error)}`);
  await bot.stop().catch(() => {});
  process.exit(1);
}

// Between a dropped socket and its reconnect timer nothing may hold the event
// loop open; this keeps the bot alive until a signal stops it.
setInterval(() => {}, 1 << 30);

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
