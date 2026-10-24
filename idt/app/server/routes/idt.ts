import { Hono } from "hono";
import { env } from "../env.ts";
import { ApiError } from "../http.ts";

export function idtRoutes(fetchEngine: typeof fetch = fetch) {
  return new Hono().get("/idt/*", async (c) => {
    const url = new URL(c.req.url);
    const res = await fetchEngine(`${env.IDT_ENGINE_URL}${url.pathname}${url.search}`, {
      headers: { Accept: "application/json" },
    }).catch(() => {
      throw new ApiError(502, "unavailable", "the IDT engine is unreachable; start it with `npm run engine`");
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      const message = typeof body.detail === "string" ? body.detail : `engine returned ${res.status}`;
      throw new ApiError(res.status === 404 ? 404 : 502, res.status === 404 ? "not_found" : "unavailable", message);
    }
    return c.json(await res.json());
  });
}
