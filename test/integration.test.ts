// End to end against a fake API and gateway: libduvet's JavaScript client, a
// fake WebSocket gateway that sends READY, SPACE_CREATE and an interaction,
// and a fake API that records the bot's answer.
//
// The API is a raw TCP server: it was written for the BEAM bridge, which
// streamed bodies chunked, and it reads both those and `Content-Length` ones.

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { Chisato } from "../src/bot";

const APP = {
  id: "app1",
  team_id: "team1",
  name: "chisato",
  description: null,
  icon: null,
  bot_user_id: "bot1",
  public: true,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  deleted_at: null,
};

const BOT = {
  id: "bot1",
  username: "chisato",
  alias: null,
  avatar: null,
  banner: null,
  custom: "",
  is_bot: true,
  flags: 0,
  badges: 0,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
};

const SPACE = {
  id: "s1",
  name: "Test space",
  description: null,
  owner_id: "u1",
  icon: null,
  banner: null,
  locale: null,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
};

const ROOM = {
  id: "r1",
  space_id: "s1",
  parent_id: null,
  type: 1,
  name: "general",
  description: null,
  position: 0,
  nsfw: false,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
};

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

interface ApiServer {
  port: number;
  close: () => void;
}

interface Gateway {
  port: number;
  stop: () => void;
}

let api: ApiServer;
let gateway: Gateway;
let bot: Chisato;
const requests: Recorded[] = [];
const callbacks: Array<Record<string, unknown>> = [];
let gatewaySocket: ServerWebSocket<undefined> | null = null;

beforeAll(async () => {
  api = startApi((request) => {
    const path = request.path;
    if (request.method === "GET" && path === "/api/applications/@me") {
      return { status: 200, body: APP };
    }
    if (
      path.startsWith(
        "/api/users/@me/teams/team1/applications/app1/commands",
      )
    ) {
      if (request.method === "PUT") {
        const body = JSON.parse(request.body.toString("utf8") || "[]");
        requests.push({ method: "PUT", path, body });
        return { status: 200, body };
      }
      return { status: 200, body: [] };
    }
    if (path.startsWith("/api/interactions/")) {
      const body = JSON.parse(request.body.toString("utf8") || "null");
      requests.push({ method: request.method, path, body });
      if (body && typeof body === "object" && "type" in body) {
        callbacks.push(body as Record<string, unknown>);
      }
      return { status: 204 };
    }
    if (path.startsWith("/api/rooms/")) {
      const body = JSON.parse(request.body.toString("utf8") || "null");
      requests.push({ method: request.method, path, body });
      return { status: 200, body: { id: "m1", room_id: "r1" } };
    }
    if (path.startsWith("/api/webhooks/")) {
      const body = JSON.parse(request.body.toString("utf8") || "null");
      requests.push({ method: request.method, path, body });
      return { status: 200, body: { id: "m2", room_id: "r1" } };
    }
    requests.push({ method: request.method, path, body: null });
    return { status: 404 };
  });

  gateway = startGateway();
  bot = new Chisato({
    token: "bottok",
    api: `127.0.0.1:${api.port}`,
    ws: `127.0.0.1:${gateway.port}`,
    secure: false,
    shards: 1,
    resume: false,
    log: () => {},
  });
  await bot.start();
}, 40_000);

afterAll(async () => {
  gatewaySocket?.close();
  await bot?.stop();
  gateway?.stop();
  api?.close();
});

test(
  "registers its commands and answers an interaction",
  async () => {
    const put = requests.find(
      (entry) => entry.method === "PUT" && entry.path.includes("/commands"),
    );
    expect(put).toBeDefined();
    const registered = (put?.body ?? []) as Array<{ name: string }>;
    expect(registered.map((command) => command.name)).toContain("ping");

    const callback = await waitFor(() => callbacks[0], 10_000);
    expect(callback.type).toBe(4);
    expect(String((callback.data as { content?: string })?.content)).toMatch(
      /Pong/,
    );
  },
  30_000,
);

// ---------------------------------------------------------------------------
// The fake API
// ---------------------------------------------------------------------------

interface RawRequest {
  method: string;
  path: string;
  body: Buffer;
}

interface RouteResult {
  status: number;
  body?: unknown;
}

function startApi(route: (request: RawRequest) => RouteResult): ApiServer {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = Buffer.alloc(0);
    let handled = false;
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer = Buffer.concat([
        buffer,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      ]);
      const request = parseRequest(buffer);
      if (!request) return;
      handled = true;
      const result = route(request);
      respond(socket, result);
    });
  });
  server.listen(0, "127.0.0.1");
  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

function parseRequest(buffer: Buffer): RawRequest | null {
  const headEnd = buffer.indexOf("\r\n\r\n");
  if (headEnd < 0) return null;
  const head = buffer.subarray(0, headEnd).toString("latin1").split("\r\n");
  const [requestLine, ...headerLines] = head;
  if (!requestLine) return null;
  const [method, target] = requestLine.split(" ");
  if (!method || !target) return null;
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers.set(
        line.slice(0, colon).trim().toLowerCase(),
        line.slice(colon + 1).trim(),
      );
    }
  }
  const path = target.split("?")[0] ?? target;
  const chunked = (headers.get("transfer-encoding") ?? "")
    .toLowerCase()
    .includes("chunked");

  if (chunked) {
    const body = parseChunks(buffer, headEnd + 4);
    if (!body) return null;
    return { method, path, body };
  }

  const length = Number(headers.get("content-length") ?? "0");
  const start = headEnd + 4;
  if (buffer.length < start + length) return null;
  return {
    method,
    path,
    body: buffer.subarray(start, start + length),
  };
}

function parseChunks(buffer: Buffer, start: number): Buffer | null {
  const chunks: Buffer[] = [];
  let offset = start;
  for (;;) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) return null;
    const size = Number.parseInt(
      buffer.subarray(offset, lineEnd).toString("latin1"),
      16,
    );
    if (!Number.isFinite(size) || size < 0) return null;
    offset = lineEnd + 2;
    if (size === 0) return Buffer.concat(chunks);
    if (buffer.length < offset + size + 2) return null;
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }
}

function respond(socket: Socket, result: RouteResult): void {
  const reason =
    result.status === 204
      ? "No Content"
      : result.status === 200
        ? "OK"
        : "Not Found";
  if (result.body === undefined) {
    socket.end(
      `HTTP/1.1 ${result.status} ${reason}\r\nconnection: close\r\n\r\n`,
    );
    return;
  }
  const body = Buffer.from(JSON.stringify(result.body));
  socket.end(
    `HTTP/1.1 ${result.status} ${reason}\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: close\r\n\r\n${body.toString("utf8")}`,
  );
}

// ---------------------------------------------------------------------------
// The fake gateway
// ---------------------------------------------------------------------------

function startGateway(): Gateway {
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      if (new URL(request.url).pathname === "/gateway") {
        if (srv.upgrade(request, { data: undefined })) {
          return undefined as unknown as Response;
        }
        return new Response("upgrade failed", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        gatewaySocket = ws;
      },
      message(ws, raw) {
        const message = JSON.parse(String(raw)) as { type?: string };
        if (message.type === "identify") {
          let seq = 0;
          const send = (type: string, data: unknown) => {
            seq += 1;
            ws.send(
              JSON.stringify({
                event: "payload",
                op: 1,
                d: { type, data },
                s: seq,
              }),
            );
          };
          send("READY", {
            user: BOT,
            sessionToken: "00000000-0000-7000-8000-000000000001",
            guild_ids: ["s1"],
            shard: [0, 1],
          });
          send("SPACE_CREATE", {
            space: SPACE,
            rooms: { r1: ROOM },
            roles_permissions: {},
            member_roles: {},
            overwrites: {},
            owner_id: "u1",
          });
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                event: "payload",
                op: 1,
                d: {
                  type: "INTERACTION_CREATE",
                  data: {
                    id: "i1",
                    application_id: "app1",
                    type: 2,
                    data: { id: "c1", name: "ping", type: 1, options: [] },
                    space_id: "s1",
                    space: SPACE,
                    room_id: "r1",
                    room: ROOM,
                    member: {
                      id: "m1",
                      space_id: "s1",
                      user_id: "u1",
                      alias: null,
                      user: {
                        id: "u1",
                        username: "tester",
                        alias: null,
                        avatar: null,
                      },
                      permissions: 4,
                    },
                    token: "itok",
                    version: 1,
                    app_permissions: 4,
                    context: 0,
                  },
                },
                s: 3,
              }),
            );
          }, 100);
        }
        if (message.type === "heartbeat") {
          ws.send(JSON.stringify({ event: "heartbeat_ack" }));
        }
      },
    },
  });
  return { port: Number(server.port), stop: () => server.stop(true) };
}

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`nothing after ${timeoutMs}ms`);
}
