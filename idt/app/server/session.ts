import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { findById, type Customer } from "./customers.ts";
import { ApiError } from "./http.ts";
import { persistentSecret } from "./secrets.ts";

const COOKIE = "tensho_session";
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60 } as const;

const SESSION_SECRET = persistentSecret("session-secret", () => randomBytes(32).toString("hex")).value;

export interface AppEnv {
  Variables: { customer: Customer };
}

export function setSession(c: Context, customerId: string): Promise<void> {
  return setSignedCookie(c, COOKIE, customerId, SESSION_SECRET, COOKIE_OPTIONS);
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const requireCustomer = createMiddleware<AppEnv>(async (c, next) => {
  const id = await getSignedCookie(c, SESSION_SECRET, COOKIE);
  const customer = id ? findById(id) : undefined;
  if (!customer) throw new ApiError(401, "unauthenticated", "sign in");
  c.set("customer", customer);
  await next();
});

export function gatewayUserId(customer: Customer): string {
  if (!customer.user_id) throw new ApiError(409, "failed_precondition", "wallet not ready");
  return customer.user_id;
}
