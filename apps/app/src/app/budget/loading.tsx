// What the Budget page shows while the server reads it: the table's frame only, with no figures and no spinner.

const BLANK_ROWS = 3;

export default function BudgetLoading() {
  return (
    <main id="main" aria-busy="true" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-10 sm:px-6">
      <h1 className="sr-only">Budget</h1>
      <p role="status" className="sr-only">
        Loading the budget.
      </p>
      <div aria-hidden="true" className="mb-10 h-12 border-b border-rule" />
      <div aria-hidden="true" className="rounded-md border border-rule">
        <div className="h-10 border-b border-rule" />
        {Array.from({ length: BLANK_ROWS }, (_, row) => (
          <div key={row} className="h-11 border-b border-rule/60 last:border-b-0" />
        ))}
      </div>
    </main>
  );
}
