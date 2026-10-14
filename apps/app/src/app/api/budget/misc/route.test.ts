import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ owner: null as string | null, count: vi.fn() }));

vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("@/server/auth", () => ({ getOwnerId: async () => state.owner }));
vi.mock("@/server/reports", () => ({ loadMiscCount: () => state.count() }));

import { GET } from "./route";

beforeEach(() => {
  state.owner = null;
  state.count.mockReset();
});

describe("GET /api/budget/misc", () => {
  it("answers 401 to anyone but the owner, and reads nothing", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(state.count).not.toHaveBeenCalled();
  });

  it("gives the owner the Misc count, uncached", async () => {
    state.owner = "owner-misc-route";
    state.count.mockResolvedValue(3);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ misc: 3 });
  });
});
