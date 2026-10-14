import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountMoney, CountSvgText } from "./CountUp";

describe("CountMoney server render", () => {
  it("puts the final figure in the HTML, once visibly and once for screen readers", () => {
    const html = renderToStaticMarkup(<CountMoney id="income" cents={123456} sign />);
    expect(html).toContain('aria-hidden="true">+$1,234.56</span>');
    expect(html).toContain('<span class="sr-only">+$1,234.56</span>');
  });

  it("keeps the full value in the tooltip and for screen readers when compact differs", () => {
    const html = renderToStaticMarkup(<CountMoney id="income" cents={2_500_000_001} compact />);
    expect(html).toContain('title="$25,000,000.01"');
    expect(html).toContain('aria-hidden="true">$25.0M</span>');
    expect(html).toContain('<span class="sr-only">$25,000,000.01</span>');
  });

  it("renders a spending figure with a true minus", () => {
    const html = renderToStaticMarkup(<CountMoney id="spending" cents={-41200} />);
    expect(html).toContain("−$412.00");
  });

  it("blank state is a bare dash: no animation target and no hidden duplicate", () => {
    const html = renderToStaticMarkup(<CountMoney id="income" cents={null} sign compact />);
    expect(html).toBe("<span>—</span>");
  });

  it("a real zero is $0.00, not a dash", () => {
    expect(renderToStaticMarkup(<CountMoney id="income" cents={0} sign />)).toContain("$0.00");
  });
});

describe("CountSvgText server render", () => {
  it("renders the signed final figure as svg text", () => {
    const html = renderToStaticMarkup(
      <svg>
        <CountSvgText id="dial" cents={-5000} x="200" y="200" />
      </svg>,
    );
    expect(html).toContain("<text");
    expect(html).toContain("−$50.00");
  });
});
