interface TMErrorBody {
  type: string;
  code?: string;
  message: string;
  field_violations?: { field: string; message: string }[];
  request_id?: string;
}

export class TMError extends Error {
  readonly status: number;
  readonly body: TMErrorBody;
  // The upstream bytes, so a relay can pass the envelope on unchanged.
  readonly raw: string;

  constructor(status: number, body: TMErrorBody, raw = JSON.stringify(body)) {
    super(body.message);
    this.name = "TMError";
    this.status = status;
    this.body = body;
    this.raw = raw;
  }
}

function isEnvelope(value: unknown): value is TMErrorBody {
  const body = value as TMErrorBody | null;
  return typeof body?.type === "string" && typeof body.message === "string";
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function unreachable(cause: unknown): TMError {
  return new TMError(502, { type: "unavailable", message: `True Markets is unreachable (${errorMessage(cause)})` });
}

export async function readTMError(res: Response): Promise<TMError> {
  const text = await res.text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (isEnvelope(parsed)) return new TMError(res.status, parsed, text);
  } catch {
    // Not JSON: fall through to a synthetic envelope.
  }
  return new TMError(res.status, {
    type: "internal",
    message: text.trim() || `upstream returned status ${res.status}`,
  });
}
