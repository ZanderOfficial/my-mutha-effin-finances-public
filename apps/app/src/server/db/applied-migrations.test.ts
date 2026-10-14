import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// migrations/applied/<env>/ is an exact copy of each file as it was applied.
// Editing a migration after it ran would make the record lie, so the copy and
// the source must match. Line endings are normalised because Windows checkouts
// may convert them.
const root = fileURLToPath(new URL("../../../../..", import.meta.url));
const sourceDir = `${root}apps/app/db/migrations`;
const appliedDir = `${root}migrations/applied`;

const normalise = (text: string) => text.replace(/\r\n/g, "\n");

function appliedFiles(): { env: string; file: string }[] {
  return readdirSync(appliedDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(`${appliedDir}/${d.name}`)
        .filter((f) => f.endsWith(".sql"))
        .map((file) => ({ env: d.name, file })),
    );
}

describe("applied migrations", () => {
  const applied = appliedFiles();

  it("records at least the migrations applied to dev", () => {
    expect(applied.filter((a) => a.env === "dev").length).toBeGreaterThanOrEqual(4);
  });

  it.each(applied)("$env/$file was not edited after it was applied", ({ env, file }) => {
    const copy = normalise(readFileSync(`${appliedDir}/${env}/${file}`, "utf8"));
    const source = normalise(readFileSync(`${sourceDir}/${file}`, "utf8"));
    expect(copy).toBe(source);
  });
});
