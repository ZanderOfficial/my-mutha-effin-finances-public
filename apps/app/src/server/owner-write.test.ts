import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ owner: "owner-write-test" as string | null }));
const logged = vi.hoisted(() => vi.fn());
const revalidated = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: revalidated }));
vi.mock("@/server/log", () => ({ logException: logged }));
vi.mock("@/server/auth", () => ({
  requireOwner: async () => {
    if (!state.owner) throw new Error("NEXT_REDIRECT");
    return state.owner;
  },
}));
vi.mock("@/server/db", () => {
  class DatabaseNotConfiguredError extends Error {}
  return { DatabaseNotConfiguredError };
});

import { DatabaseNotConfiguredError } from "@/server/db";
import { ownerWrite } from "./owner-write";

class DriverError extends Error {
  name = "DriverError";
  code = "XX000";
}

beforeEach(() => {
  state.owner = "owner-write-test";
  logged.mockClear();
  revalidated.mockClear();
});

describe("ownerWrite", () => {
  it("refreshes the page and answers saved after a good write", async () => {
    const result = await ownerWrite(async () => ({ ok: true }), "Done.");
    expect(result).toEqual({ status: "saved", message: "Done." });
    expect(revalidated).toHaveBeenCalledWith("/budget");
  });

  it("passes a refusal through in words without refreshing", async () => {
    const result = await ownerWrite(async () => ({ ok: false, message: "Nope." }));
    expect(result).toEqual({ status: "error", message: "Nope." });
    expect(revalidated).not.toHaveBeenCalled();
  });

  it("says saving is not set up when there is no database", async () => {
    const result = await ownerWrite(async () => {
      throw new DatabaseNotConfiguredError();
    });
    expect(result).toEqual({ status: "error", message: "Saving is not set up on this server." });
    expect(logged).not.toHaveBeenCalled();
  });

  it("logs an unexpected error and answers in words instead of throwing", async () => {
    const err = new DriverError("value 12345 in query");
    const result = await ownerWrite(async () => {
      throw err;
    });
    expect(result).toEqual({ status: "error", message: "Could not save. Try again." });
    expect(logged).toHaveBeenCalledWith("budget.write_failed", err);
  });

  it("still refuses a visitor who is not the owner by throwing", async () => {
    state.owner = null;
    await expect(ownerWrite(async () => ({ ok: true }))).rejects.toThrow("NEXT_REDIRECT");
  });
});
