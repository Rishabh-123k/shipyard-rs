import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { errorResponse } from "../http.ts";
import { idtRoutes } from "./idt.ts";

function appWith(fetchEngine: typeof fetch) {
  const app = new Hono().route("/api", idtRoutes(fetchEngine));
  app.onError(errorResponse);
  return app;
}

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
