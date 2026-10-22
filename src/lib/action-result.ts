import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DomainError } from "@/server/errors";

export type ActionError = { code: string; message: string; field?: string; details?: unknown };

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/**
 * Runs a Server Action body and maps expected failures to `{ ok: false }`.
 * Next.js control-flow errors (redirect, notFound) pass through untouched;
 * anything else is logged and rethrown so the user sees a generic error.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof DomainError) {
      return {
        ok: false,
        error: { code: e.code, message: e.message, field: e.field, details: e.details },
      };
    }
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return {
        ok: false,
        error: {
          code: "Validation",
          message: first?.message ?? "Invalid input",
          field: first?.path.length ? first.path.join(".") : undefined,
          details: e.issues,
        },
      };
    }
    console.error("Unexpected action error", e);
    throw e;
  }
}
