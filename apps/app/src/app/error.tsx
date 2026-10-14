"use client";

/**
 * Error boundary for every screen. The text is fixed: the error's message is
 * never shown, because an exception message can carry a query, a value or a
 * path. The server has already logged the class name through `src/server/log`.
 */
export default function ErrorBoundary({ retry }: { error: Error; retry: () => void }) {
  return (
    <main id="main" className="flex-1 px-6 py-16 sm:px-10">
      <section aria-labelledby="error-title" className="max-w-xl border-t border-rule pt-4">
        <h1 id="error-title" className="mb-2 font-display text-5xl font-black uppercase leading-none tracking-wide">
          Something broke
        </h1>
        <p className="mb-6 text-[17px] text-muted">
          <span className="font-bold text-spending">! </span>
          That screen could not load. Nothing was changed. Try again.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center border-2 border-foreground px-6 text-base font-bold"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
