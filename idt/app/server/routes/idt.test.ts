import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError, errorResponse } from "../http.ts";
import { idtRoutes } from "./idt.ts";

const allow: MiddlewareHandler = async (_c, next) => next();
const deny: MiddlewareHandler = async () => {
  throw new ApiError(401, "unauthenticated", "sign in");
};

function appWith(fetchEngine: typeof fetch, auth: MiddlewareHandler = allow) {
  const app = new Hono().route("/api", idtRoutes(fetchEngine, auth));
  app.onError(errorResponse);
  return app;
}

describe("idt ask proxy", () => {
  it("forwards the question body to the engine", async () => {
    const fetchEngine = vi.fn<typeof fetch>(async () => Response.json({ answer: "a" }));
    const res = await appWith(fetchEngine).request("/api/idt/ask", { method: "POST", body: JSON.stringify({ question: "why?" }) });

    expect(res.status).toBe(200);
    const [url, init] = fetchEngine.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:8787/api/idt/ask");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ question: "why?" });
  });

  it("requires a signed-in customer", async () => {
    const fetchEngine = vi.fn<typeof fetch>();
    const res = await appWith(fetchEngine, deny).request("/api/idt/ask", { method: "POST", body: "{}" });

    expect(res.status).toBe(401);
    expect(fetchEngine).not.toHaveBeenCalled();
  });

  it("maps an engine validation error to 400", async () => {
    const res = await appWith(async () => Response.json({ detail: [] }, { status: 422 })).request("/api/idt/ask", {
      method: "POST",
      body: JSON.stringify({ question: "" }),
    });

    expect(res.status).toBe(400);
  });
});

describe("idt proxy", () => {
  it("forwards path and query to the engine and returns its JSON", async () => {
    const fetchEngine = vi.fn<typeof fetch>(async () => Response.json([{ venue: "kalshi" }]));
    const res = await appWith(fetchEngine).request("/api/idt/ladders?asset=ETH");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ venue: "kalshi" }]);
    expect(String(fetchEngine.mock.calls[0]![0])).toBe("http://127.0.0.1:8787/api/idt/ladders?asset=ETH");
  });

  it("passes an engine 404 through with its message", async () => {
    const app = appWith(async () => Response.json({ detail: "no ladder for that venue and date" }, { status: 404 }));
    const res = await app.request("/api/idt/distribution?venue=x&resolution_at=y");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: "no ladder for that venue and date" });
  });

  it("answers 502 when the engine is down", async () => {
    const app = appWith(async () => {
      throw new TypeError("fetch failed");
    });
    const res = await app.request("/api/idt/health");

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ type: "unavailable" });
  });
});
