import { describe, expect, it } from "vitest";
import { categoryLabel } from "./budget";

describe("categoryLabel", () => {
  it("humanises Plaid's category names", () => {
    expect(categoryLabel("FOOD_AND_DRINK")).toBe("Food and drink");
    expect(categoryLabel("UNCATEGORIZED")).toBe("Uncategorized");
  });
});
