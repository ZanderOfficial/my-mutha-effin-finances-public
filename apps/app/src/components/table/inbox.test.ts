import { describe, expect, it } from "vitest";
import { inboxFormId } from "./inbox";

// Synthetic source keys only.
describe("inboxFormId", () => {
  it("keeps a plain key readable", () => {
    expect(inboxFormId("misc", "corner cafe")).toBe("misc-corner-cafe");
    expect(inboxFormId("unsorted", "mobile deposit 2")).toBe("unsorted-mobile-deposit-2");
  });

  it("tells apart keys that differ only in punctuation or spacing", () => {
    const ids = ["shop co", "shop.co", "shop-co", "shop  co", "Shop co"].map((key) => inboxFormId("misc", key));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives the same key the same id every time", () => {
    expect(inboxFormId("misc", "shop.co")).toBe(inboxFormId("misc", "shop.co"));
    expect(inboxFormId("misc", "shop.co")).toMatch(/^misc-shop-co_[0-9a-z]+$/);
  });
});
