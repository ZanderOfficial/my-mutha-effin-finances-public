import { describe, expect, it } from "vitest";
import { CHART_COLOURS } from "./income-chart";

/**
 * Contrast of every text pair in DESIGN.md's palette, computed with the WCAG 2
 * relative-luminance formula. If a palette value is edited and a pair drops
 * under its bar (4.5:1 for text, 3:1 for the large hero numerals), this fails.
 */
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;

const BACKGROUND = hex("#0a0a0b");
const PANEL = hex("#111113");
// The Budget tables' hover and edit surface, and the filled segment of a segmented control.
const PANEL_RAISED = hex("#121214");
const RULE = hex("#2a2a2e");
const TEXT = hex("#f5f5f5");
const MUTED = hex("#a1a1a8");
const INCOME = hex("#39ff88");
const SPENDING = hex("#ff2d55");
// Hero halves: income and spending tints over the page background.
const INCOME_TINT = over(INCOME, 0.12, BACKGROUND);
const SPENDING_TINT = over(SPENDING, 0.13, BACKGROUND);

describe("palette contrast", () => {
  it("body text and muted text clear 4.5:1 on every surface", () => {
    for (const bg of [BACKGROUND, PANEL, INCOME_TINT, SPENDING_TINT]) {
      expect(contrast(TEXT, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(MUTED, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("income green clears 4.5:1 wherever small text uses it", () => {
    for (const bg of [BACKGROUND, PANEL, INCOME_TINT, SPENDING_TINT]) {
      expect(contrast(INCOME, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("spending red clears 4.5:1 on the page, panels and its own tint", () => {
    for (const bg of [BACKGROUND, PANEL, SPENDING_TINT]) {
      expect(contrast(SPENDING, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("spending red on the income tint is large-text only, and nothing small sits there", () => {
    // The red half and the green half never overlap: small red text is only
    // ever drawn on the page, a panel or the red half (see the test above).
    const ratio = contrast(SPENDING, INCOME_TINT);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it("hero numerals clear 3:1 against their own glow at the strength the halo reaches the glyph edge", () => {
    // A 28px text-shadow at 0.6 to 0.65 alpha is about half strength at the
    // edge of a thick glyph stem; this checks that half-strength halo.
    expect(contrast(INCOME, over(INCOME, 0.6 * 0.5, BACKGROUND))).toBeGreaterThanOrEqual(3);
    expect(contrast(SPENDING, over(SPENDING, 0.65 * 0.5, BACKGROUND))).toBeGreaterThanOrEqual(3);
  });

  it("the To sort count (page colour on spending red) and the filled button (page colour on text) clear 4.5:1", () => {
    expect(contrast(BACKGROUND, SPENDING)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(BACKGROUND, TEXT)).toBeGreaterThanOrEqual(4.5);
  });

  it("table cells keep text, muted, income and spending at 4.5:1 on the raised hover and edit panel", () => {
    for (const fg of [TEXT, MUTED, INCOME, SPENDING]) {
      expect(contrast(fg, PANEL_RAISED)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the current segment of a segmented control (text on the rule colour) clears 4.5:1", () => {
    expect(contrast(TEXT, RULE)).toBeGreaterThanOrEqual(4.5);
  });

  it("the cell edit border (text colour) and the refused-value border (spending) clear 3:1 on the raised panel", () => {
    expect(contrast(TEXT, PANEL_RAISED)).toBeGreaterThanOrEqual(3);
    expect(contrast(SPENDING, PANEL_RAISED)).toBeGreaterThanOrEqual(3);
  });

  it("the keyboard focus ring (text colour) clears 3:1 on every surface", () => {
    for (const bg of [BACKGROUND, PANEL, INCOME_TINT, SPENDING_TINT]) {
      expect(contrast(TEXT, bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("the Income chart's bars and lines clear 3:1 against the chart panel", () => {
    const chartPanel = hex(CHART_COLOURS.panel);
    const dimBar = over(hex(CHART_COLOURS.bar), CHART_COLOURS.barOpacity, chartPanel);
    expect(contrast(dimBar, chartPanel)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(CHART_COLOURS.bar), chartPanel)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(CHART_COLOURS.trend), chartPanel)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(CHART_COLOURS.average), chartPanel)).toBeGreaterThanOrEqual(3);
  });

  it("the Income chart's lines clear 3:1 against the dark halo drawn under them, wherever they cross a bar", () => {
    const halo = hex(CHART_COLOURS.panel);
    expect(contrast(hex(CHART_COLOURS.trend), halo)).toBeGreaterThanOrEqual(3);
    expect(contrast(hex(CHART_COLOURS.average), halo)).toBeGreaterThanOrEqual(3);
  });
});
