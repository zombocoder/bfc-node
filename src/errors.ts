export type BfcErrorCode =
  | "BAD_MAGIC"
  | "IO"
  | "CRC"
  | "INVAL"
  | "EXISTS"
  | "NOT_FOUND"
  | "PERM"
  | "CLOSED"
  | "UNSUPPORTED_PLATFORM";

export class BfcError extends Error {
  readonly code: BfcErrorCode;
  readonly path?: string;

  constructor(message: string, code: BfcErrorCode, path?: string) {
    super(message);
    this.name = "BfcError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

/**
 * Errors crossing the native boundary are plain Error objects tagged with
 * `name` and `code`, not BfcError instances, so identity checks would miss
 * them. Match on the shape instead.
 */
export function isBfcError(value: unknown): value is BfcError {
  return value instanceof Error && value.name === "BfcError" && "code" in value;
}
