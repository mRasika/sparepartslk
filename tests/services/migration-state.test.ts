import { describe, expect, it } from "vitest";
// Plain ESM used by the Docker image's migrate job (no TypeScript there).
import { migrationState } from "../../deploy/docker/migrator/migration-state.mjs";

const journal = [1, 2, 3];

describe("migrationState: what the migrate job should do", () => {
  it("empty database: apply everything", () => {
    expect(migrationState({ applied: [], journal })).toEqual({ action: "migrate", newer: [], pending: [1, 2, 3] });
  });

  it("behind: apply the missing ones", () => {
    expect(migrationState({ applied: [1, 2], journal })).toEqual({ action: "migrate", newer: [], pending: [3] });
  });

  it("same as this version: nothing to do", () => {
    expect(migrationState({ applied: [1, 2, 3], journal })).toEqual({ action: "up-to-date", newer: [], pending: [] });
  });

  it("database newer than this version: a rollback, leave it alone", () => {
    expect(migrationState({ applied: [1, 2, 3, 4], journal })).toEqual({ action: "rollback", newer: [4], pending: [] });
  });

  it("database has changes this version lacks AND lacks some of its own: disagree", () => {
    expect(migrationState({ applied: [1, 2, 4], journal: [1, 2, 3, 5] })).toEqual({
      action: "disagree",
      newer: [4],
      pending: [5],
    });
  });
});
