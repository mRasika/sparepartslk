import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runAction } from "@/lib/action-result";
import { InsufficientStock, NotFound } from "@/server/errors";

describe("runAction", () => {
  it("wraps a result as ok", async () => {
    await expect(runAction(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  it("maps a DomainError to its code and details", async () => {
    const result = await runAction(async () => {
      throw new InsufficientStock({ partId: "p1", sku: "BRK-1", available: 2, requested: 3 });
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("InsufficientStock");
    expect(result.error.details).toMatchObject({ available: 2, requested: 3 });
  });

  it("maps a ZodError to Validation with the field path", async () => {
    const result = await runAction(async () => z.object({ qty: z.number().positive() }).parse({ qty: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Validation");
    expect(result.error.field).toBe("qty");
  });

  it("rethrows unexpected errors after logging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runAction(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("gives every DomainError subclass its class name as code", () => {
    expect(new NotFound("x").code).toBe("NotFound");
    expect(new NotFound("x")).toBeInstanceOf(Error);
  });
});
