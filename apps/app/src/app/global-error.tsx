"use client";

/**
 * Last-resort boundary for a failure in the root layout. It replaces the whole
 * document, so it carries its own html and body and uses no app styles that
 * could themselves be the failure. Fixed text only; see app/error.tsx.
 */
export default function GlobalError({ retry }: { error: Error; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0a0a0b", color: "#f5f5f5", fontFamily: "sans-serif", padding: "4rem 2rem" }}>
        <main>
          <h1>Something broke</h1>
          <p>! The app could not load. Nothing was changed. Try again.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ minHeight: 44, padding: "0 1.5rem", background: "transparent", color: "#f5f5f5", border: "2px solid #f5f5f5", fontWeight: 700 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
