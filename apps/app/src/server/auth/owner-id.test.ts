import { describe, expect, it, vi } from "vitest";

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

import { getOwnerId, ownerIdFor, requireOwner } from "./index";

const OWNER = "owner@example.test";

describe("ownerIdFor", () => {
  it("returns the user id only for the owner", () => {
    expect(ownerIdFor({ id: "user-1", email: OWNER }, OWNER)).toBe("user-1");
    expect(ownerIdFor({ id: "user-2", email: "other@example.test" }, OWNER)).toBeNull();
  });

  it("is null without a usable id", () => {
    expect(ownerIdFor({ email: OWNER }, OWNER)).toBeNull();
    expect(ownerIdFor({ id: "  ", email: OWNER }, OWNER)).toBeNull();
    expect(ownerIdFor({ id: 7, email: OWNER }, OWNER)).toBeNull();
  });

  it("is null when OWNER_EMAIL is not configured", () => {
    expect(ownerIdFor({ id: "user-1", email: OWNER }, "")).toBeNull();
  });
});

describe("fail closed with no auth configuration", () => {
  it("returns no owner and requireOwner redirects", async () => {
    const saved = { ...process.env };
    delete process.env.NEON_AUTH_BASE_URL;
    delete process.env.NEON_AUTH_COOKIE_SECRET;
    try {
      expect(await getOwnerId()).toBeNull();
      await expect(requireOwner()).rejects.toThrow("NEXT_REDIRECT");
    } finally {
      process.env = saved;
    }
  });
});
