import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/logo/route";
import { db } from "@/server/db/client";
import { logo } from "@/server/db/schema";
import { DomainError, Forbidden } from "@/server/errors";
import { LOGO_MAX_BYTES, readLogo, saveLogo } from "@/server/services/logo";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const PNG = new Uint8Array(readFileSync("e2e/fixtures/logo.png"));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);

async function refusal(promise: Promise<unknown>) {
  const err = (await promise.catch((e: unknown) => e)) as DomainError;
  expect(err).toBeInstanceOf(DomainError);
  expect(err.field).toBe("logo");
  return err.message as string;
}

describe("logo", () => {
  beforeEach(resetDb);

  it("stores a PNG and gives its /api/logo address", async () => {
    const admin = await makeUser("admin");
    const { url } = await saveLogo(admin, { type: "image/png", bytes: PNG });
    expect(url).toMatch(/^\/api\/logo\?v=\d+$/);
    const stored = await readLogo();
    expect(stored?.contentType).toBe("image/png");
    expect(new Uint8Array(stored!.data)).toEqual(PNG);
    expect(url).toBe(`/api/logo?v=${stored!.updatedAt.getTime()}`);
  });

  it("accepts JPEG and WebP, and a new upload replaces the old one", async () => {
    const admin = await makeUser("admin");
    await saveLogo(admin, { type: "image/png", bytes: PNG });
    await saveLogo(admin, { type: "image/jpeg", bytes: JPEG });
    await saveLogo(admin, { type: "image/webp", bytes: WEBP });
    const rows = await db.select().from(logo);
    expect(rows).toHaveLength(1);
    expect(rows[0].contentType).toBe("image/webp");
    expect(new Uint8Array(rows[0].data)).toEqual(WEBP);
  });

  it("refuses an empty file, another type, bytes that don't match, and over 1 MB", async () => {
    const admin = await makeUser("admin");
    expect(await refusal(saveLogo(admin, { type: "image/png", bytes: new Uint8Array() }))).toBe("Choose an image");
    expect(await refusal(saveLogo(admin, { type: "image/gif", bytes: PNG }))).toBe("Use a PNG, JPG or WebP image");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(await refusal(saveLogo(admin, { type: "image/png", bytes: svg }))).toBe("Use a PNG, JPG or WebP image");
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(PNG.subarray(0, 8));
    expect(await refusal(saveLogo(admin, { type: "image/png", bytes: big }))).toBe("Keep the logo under 1 MB");
    expect(await db.select().from(logo)).toHaveLength(0);
  });

  it("is admin only", async () => {
    const staff = await makeUser("staff");
    await expect(saveLogo(staff, { type: "image/png", bytes: PNG })).rejects.toBeInstanceOf(Forbidden);
  });

  // GET takes no request, so an old link's ?v= can't change what it serves: always the current logo.
  it("serves the stored logo with its type, nosniff and a long cache", async () => {
    const admin = await makeUser("admin");
    await saveLogo(admin, { type: "image/png", bytes: PNG });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 when there is no logo", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
