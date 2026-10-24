import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { env } from "../env.ts";
import { ApiError } from "../http.ts";
import { requireCustomer } from "../session.ts";

async function forward(fetchEngine: typeof fetch, url: URL, init: RequestInit = {}) {
  const res = await fetchEngine(`${env.IDT_ENGINE_URL}${url.pathname}${url.search}`, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  }).catch(() => {
    throw new ApiError(502, "unavailable", "the cryptoshi engine is unreachable; start it with `npm run engine`");
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    const message = typeof body.detail === "string" ? body.detail : `engine returned ${res.status}`;
    if (res.status === 404) throw new ApiError(404, "not_found", message);
    if (res.status === 422) throw new ApiError(400, "invalid_argument", "question must be 3 to 500 characters");
    throw new ApiError(502, "unavailable", message);
  }
  return res.json();
}

// Asking spends LLM and warehouse credits, so it needs a signed-in customer; market reads stay public.
export function idtRoutes(fetchEngine: typeof fetch = fetch, auth: MiddlewareHandler = requireCustomer) {
  return new Hono()
    .post("/idt/ask", auth, async (c) => {
      const body = await c.req.text();
      return c.json(await forward(fetchEngine, new URL(c.req.url), { method: "POST", body }));
    })
    .get("/idt/*", async (c) => c.json(await forward(fetchEngine, new URL(c.req.url))));
}
