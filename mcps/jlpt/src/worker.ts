import { createMcpHandler } from "agents/mcp/server";

import { HttpJlptRemoteClient, JlptApiError } from "./remote/client.js";
import { createJlptRemoteServer } from "./remote/server.js";
import type { JlptRemoteClient } from "./remote/types.js";

interface RateLimitResult {
  success: boolean;
}

interface RateLimiter {
  limit(options: { key: string }): Promise<RateLimitResult>;
}

export interface JlptWorkerEnv {
  JLPT_API_BASE_URL?: string;
  JLPT_API_TIMEOUT_MS?: string;
  JLPT_ENABLE_WRITES?: string;
  MCP_RATE_LIMITER: RateLimiter;
  JLPT_WRITE_RATE_LIMITER?: RateLimiter;
}

interface RemoteConfig {
  baseUrl: URL;
  timeoutMs: number;
  writesEnabled: boolean;
}

interface CachedClient {
  signature: string;
  client: HttpJlptRemoteClient;
}

let cachedClient: CachedClient | undefined;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

export function loadJlptRemoteConfig(env: JlptWorkerEnv): RemoteConfig {
  const baseUrl = new URL(env.JLPT_API_BASE_URL ?? "https://jlpt.mangagaki.net");
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.hostname !== "jlpt.mangagaki.net" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.port ||
    (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("JLPT_API_BASE_URL must be https://jlpt.mangagaki.net.");
  }
  return {
    baseUrl,
    timeoutMs: boundedInteger(env.JLPT_API_TIMEOUT_MS, 10_000, 1_000, 20_000),
    writesEnabled: env.JLPT_ENABLE_WRITES === "true",
  };
}

function getClient(env: JlptWorkerEnv): HttpJlptRemoteClient {
  const config = loadJlptRemoteConfig(env);
  const signature = JSON.stringify([config.baseUrl.href, config.timeoutMs]);
  if (cachedClient?.signature !== signature) {
    cachedClient = {
      signature,
      client: new HttpJlptRemoteClient({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
    };
  }
  return cachedClient.client;
}

export function createJlptWorkerServer(
  env: JlptWorkerEnv,
  client: JlptRemoteClient = getClient(env),
) {
  const config = loadJlptRemoteConfig(env);
  return createJlptRemoteServer({
    client,
    writesEnabled: config.writesEnabled,
    takeWriteLimit: async () => {
      if (!env.JLPT_WRITE_RATE_LIMITER) {
        throw new JlptApiError(
          "JLPT_WRITE_LIMIT_UNAVAILABLE",
          "JLPT write rate limiter is not configured.",
          503,
          false,
        );
      }
      const result = await env.JLPT_WRITE_RATE_LIMITER.limit({ key: "jlpt-write" });
      if (!result.success) {
        throw new JlptApiError(
          "JLPT_WRITE_RATE_LIMITED",
          "JLPT write rate limit reached.",
          429,
          true,
        );
      }
    },
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const worker = {
  async fetch(
    request: Request,
    env: JlptWorkerEnv,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      try {
        const health = await getClient(env).health();
        const config = loadJlptRemoteConfig(env);
        return jsonResponse(
          {
            status: health.ok ? "ok" : "degraded",
            service: "@mymcp/jlpt-remote",
            upstream: health.ok ? "ok" : "degraded",
            writes: config.writesEnabled ? "enabled" : "disabled",
          },
          health.ok ? 200 : 503,
        );
      } catch {
        return jsonResponse(
          {
            status: "degraded",
            service: "@mymcp/jlpt-remote",
            upstream: "unavailable",
          },
          503,
        );
      }
    }

    if (url.pathname !== "/mcp") return jsonResponse({ error: "not_found" }, 404);

    const rateLimit = await env.MCP_RATE_LIMITER.limit({ key: "jlpt-mcp" });
    if (!rateLimit.success) return jsonResponse({ error: "rate_limited" }, 429);

    const handler = createMcpHandler(() => createJlptWorkerServer(env), { route: "/mcp" });
    return handler(request, env, context);
  },
} satisfies ExportedHandler<JlptWorkerEnv>;

export default worker;
