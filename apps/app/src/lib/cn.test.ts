import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("lets a later class win over an earlier one that sets the same property", () => {
    expect(cn("h-10 px-2.5 text-left text-muted", "text-right")).toBe("h-10 px-2.5 text-muted text-right");
    expect(cn("min-h-11 px-3 text-[14px] text-muted", "px-2 text-[13px]")).toBe("min-h-11 text-muted px-2 text-[13px]");
    expect(cn("border border-rule text-foreground", "border-income text-income")).toBe("border border-income text-income");
  });

  it("drops empty and false values", () => {
    expect(cn("h-11", false, undefined, "", "px-2.5")).toBe("h-11 px-2.5");
  });
});
