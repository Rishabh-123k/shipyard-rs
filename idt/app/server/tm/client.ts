import { readTMError, unreachable } from "./errors.ts";
import { mintOrgToken, organizationId } from "./token.ts";

export const TM_API_URL = "https://api.truemarkets.co";

export const deps = {
  fetch: (input: string, init?: RequestInit): Promise<Response> => fetch(input, init),
  mintOrgToken,
  organizationId,
};

interface TMRequest {
  method?: "GET" | "POST";
  body?: unknown;
  onBehalfOf?: string;
  auth?: "org" | "none";
}

export async function tmFetch<T>(path: string, request: TMRequest = {}): Promise<T> {
  const { method = "GET", body, onBehalfOf, auth = "org" } = request;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth === "org") headers.Authorization = `Bearer ${await deps.mintOrgToken()}`;
  if (onBehalfOf) headers["TM-On-Behalf-Of"] = onBehalfOf;

  const res = await deps
    .fetch(`${TM_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    .catch((err: unknown) => {
      throw unreachable(err);
    });
  if (!res.ok) throw await readTMError(res);
  return (await res.json()) as T;
}
