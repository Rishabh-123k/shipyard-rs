import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { POSITIVE_DECIMAL } from "../shared/validation.ts";
import { TMError } from "./tm/errors.ts";

interface FieldViolation {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly type: string;
  readonly code: string | undefined;
  readonly fieldViolations: FieldViolation[] | undefined;

  constructor(
    status: ContentfulStatusCode,
    type: string,
    message: string,
    options: { code?: string; fieldViolations?: FieldViolation[] } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.code = options.code;
    this.fieldViolations = options.fieldViolations;
  }
}

export const quoteExpired = () =>
  new ApiError(409, "failed_precondition", "quote expired, review again", { code: "quote_stale" });

export const dryRunBlocked = () =>
  new ApiError(403, "failed_precondition", "DRY_RUN is on, so nothing was signed or sent. Set DRY_RUN=false to trade for real.", {
    code: "dry_run",
  });

export const nothingToSign =() => new ApiError(502, "unavailable", "True Markets returned nothing to sign");

export const positiveDecimal = z.string().regex(POSITIVE_DECIMAL, "must be a positive decimal number");

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const violations = parsed.error.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    message: issue.message,
  }));
  const first = violations[0]!;
  throw new ApiError(400, "invalid_argument", `${first.field}: ${first.message}`, { fieldViolations: violations });
}

export function errorResponse(err: Error, c: Context): Response {
  if (err instanceof TMError) {
    return c.body(err.raw, err.status as ContentfulStatusCode, { "Content-Type": "application/json" });
  }
  if (err instanceof ApiError) {
    return c.json(
      {
        type: err.type,
        ...(err.code && { code: err.code }),
        message: err.message,
        ...(err.fieldViolations && { field_violations: err.fieldViolations }),
      },
      err.status,
    );
  }
  console.error(err);
  return c.json({ type: "internal", message: "internal server error" }, 500);
}
