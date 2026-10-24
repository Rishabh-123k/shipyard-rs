import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { findById, sessionVersion, type Customer } from "./customers.ts";
import { ApiError } from "./http.ts";
import { persistentSecret } from "./secrets.ts";

const COOKIE = "tensho_session";
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 7 * 24 * 60 * 60 } as const;

const SESSION_SECRET = persistentSecret("session-secret", () => randomBytes(32).toString("hex")).value;

export interface AppEnv {
  Variables: { customer: Customer };
}

// The cookie carries "<customer id>.<session version>" so a password reset can revoke every older session.
export function setSession(c: Context, customer: Customer): Promise<void> {
  return setSignedCookie(c, COOKIE, `${customer.id}.${sessionVersion(customer)}`, SESSION_SECRET, COOKIE_OPTIONS);
}

function customerFromCookie(value: string | false | undefined): Customer | undefined {
  if (!value) return undefined;
  const dot = value.lastIndexOf(".");
  // Cookies issued before versioning carry a bare id and count as version 0.
  const [id, version] = dot === -1 ? [value, 0] : [value.slice(0, dot), Number(value.slice(dot + 1))];
  const customer = findById(id);
  return customer && sessionVersion(customer) === version ? customer : undefined;
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const requireCustomer = createMiddleware<AppEnv>(async (c, next) => {
  const customer = customerFromCookie(await getSignedCookie(c, SESSION_SECRET, COOKIE));
  if (!customer) throw new ApiError(401, "unauthenticated", "sign in");
  c.set("customer", customer);
  await next();
});

export function gatewayUserId(customer: Customer): string {
  if (!customer.user_id) throw new ApiError(409, "failed_precondition", "wallet not ready");
  return customer.user_id;
}
