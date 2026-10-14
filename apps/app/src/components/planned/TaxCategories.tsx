"use client";
// The owner's tax categories as a table: each named, put on a Schedule C line or marked personal, and confirmed.

import { useLayoutEffect, useRef, useState } from "react";
import {
  addStartingCategoriesAction,
  addTaxCategoryAction,
  mapTaxCategoryAction,
  removeTaxCategoryAction,
  renameTaxCategoryAction,
} from "@/app/budget/planned-actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { NameCell, SelectCell } from "@/components/table/cells";
import { Column, DataTable } from "@/components/table/DataTable";
import { ToggleTabs } from "@/components/table/Disclosure";
import { focusPastRow } from "@/components/table/focus";
import { BlankCells, CancelCell, NewRowLine, useDraftRow } from "@/components/table/NewRow";
import { RemovalNotice } from "@/components/table/removal";
import { HiddenField, Row, RowForm, StatusCell, useRow } from "@/components/table/RowForm";
import { InlineConfirm, MenuItem, RowMenu } from "@/components/table/RowMenu";
import { CELL, STICKY_FIRST, TD } from "@/components/table/styles";
import { shortLineName, taxCategoryState, taxCategoryViews } from "@/lib/budget-table";
import { formatShortDate } from "@/lib/format";
import { STARTING_CATEGORIES, lineName, mappingValue, type ScheduleCForm, type TaxCategory } from "@/lib/tax-categories";

const COLUMNS = 5;
const NEW_NAME_ID = "new-category-name";

export function TaxCategories({ categories, scheduleC }: { categories: TaxCategory[]; scheduleC: ScheduleCForm | null }) {
  const views = taxCategoryViews(categories);
  const [filter, setFilter] = useState("all");
  const shown = new Set((views.find((view) => view.id === filter) ?? views[0]).categories.map((category) => category.id));
  const proposed = views.find((view) => view.id === "confirm")?.categories.length ?? 0;

  return (
    <>
      <p className="mb-2 max-w-2xl text-pretty text-[14px] text-muted">
        Your own list, each put on a Schedule C line or marked personal. The app records what you choose; it does not say what is
        deductible.
        {proposed > 0 && ` ${proposed} still show the app's proposed line: check each one, ideally with your accountant, and confirm it.`}
      </p>
      {scheduleC && <SourceNote form={scheduleC} />}
      {categories.length > 0 && (
        <div className="mb-2">
          <ToggleTabs label="Show tax categories" tabs={views.map(({ id, label, categories: list }) => ({ id, label, count: list.length }))} current={filter} onChange={setFilter} />
        </div>
      )}
      <RemovalNotice>
      <DataTable label="Tax categories" minWidth="min-w-[640px]" hint="State">
        <thead>
          <tr>
            <Column kind="text" className={`${STICKY_FIRST} z-20`}>
              Name
            </Column>
            <Column kind="select" className="w-full min-w-56">
              Schedule C line
            </Column>
            <Column kind="status">State</Column>
            <Column srOnly className="w-28 min-w-28">
              Save state
            </Column>
            <Column srOnly className="w-11">
              Row menu
            </Column>
          </tr>
        </thead>
        <tbody>
          {categories.length === 0 && <StartingSet />}
          {categories.map((category) => (
            <CategoryRow key={category.id} category={category} scheduleC={scheduleC} hidden={!shown.has(category.id)} />
          ))}
        </tbody>
        <NewCategoryRows />
      </DataTable>
      </RemovalNotice>
    </>
  );
}

function SourceNote({ form }: { form: ScheduleCForm }) {
  return (
    <p className="mb-3 text-[13px] text-muted">
      Lines copied from the {form.year} Schedule C (Form 1040),{" "}
      <a href={form.sourceUrl} className="underline underline-offset-4" rel="noreferrer" target="_blank">
        irs.gov
      </a>
      , checked {formatShortDate(form.checkedOn, true)}.
    </p>
  );
}

/** The empty state: the owner's spreadsheet list, offered once, each with a proposed line to check. */
function StartingSet() {
  return (
    <tr>
      <td colSpan={COLUMNS} className={`${CELL} px-2.5 py-3`}>
        <ActionForm action={addStartingCategoriesAction} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-muted">
            Nothing here yet. Start from your spreadsheet&rsquo;s {STARTING_CATEGORIES.length} categories, each with a proposed line to check.
          </span>
          <SubmitButton className="border-income">Add my {STARTING_CATEGORIES.length} categories</SubmitButton>
        </ActionForm>
      </td>
    </tr>
  );
}

const menuId = (category: TaxCategory) => `category-menu-${category.id}`;
const mappingId = (category: TaxCategory) => `category-${category.id}-mapping`;

function CategoryRow({ category, scheduleC, hidden }: { category: TaxCategory; scheduleC: ScheduleCForm | null; hidden: boolean }) {
  const [removing, setRemoving] = useState(false);
  const rowRef = useRef<HTMLTableRowElement>(null);

  // A save that moves this row out of the shown filter passes focus on to the next row, before the row hides.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (hidden && row?.contains(document.activeElement)) focusPastRow(row);
  }, [hidden]);

  return (
    <RowForm id={`category-${category.id}`} action={renameTaxCategoryAction}>
      <Row ref={rowRef} hidden={hidden || removing}>
        <NameCell
          name="name"
          label={`Name of tax category ${category.name}`}
          rowName={category.name}
          defaultValue={category.name}
          maxLength={80}
          required
          className={STICKY_FIRST}
        />
        <LineCell category={category} scheduleC={scheduleC} />
        <StateCell category={category} />
        <StatusCell>
          <HiddenField name="categoryId" value={category.id} />
        </StatusCell>
        <RowMenu id={menuId(category)} label={`Menu for ${category.name}`}>
          <MenuItem onSelect={() => setRemoving(true)} danger>
            Remove…
          </MenuItem>
        </RowMenu>
      </Row>
      {removing && !hidden && <RemoveStrip category={category} onKeep={() => setRemoving(false)} />}
    </RowForm>
  );
}

/** The cell shows the line number and a short label; the full line is in its title and read to screen readers. */
function LineCell({ category, scheduleC }: { category: TaxCategory; scheduleC: ScheduleCForm | null }) {
  const full = category.line ? lineName(category.line) : undefined;
  return (
    <SelectCell
      id={mappingId(category)}
      name="mapping"
      label={`Schedule C line for ${category.name}`}
      defaultValue={mappingValue(category.mapping)}
      action={mapTaxCategoryAction}
      title={full}
      description={full}
    >
      <option value="">Not on a line yet</option>
      <option value="personal">Personal, not on Schedule C</option>
      {category.line && category.line.year !== scheduleC?.year && (
        <option value={mappingValue(category.mapping)}>
          {shortLineName(category.line)} ({category.line.year})
        </option>
      )}
      {scheduleC?.lines.map((line) => (
        <option key={line.line} value={mappingValue({ kind: "line", year: line.year, line: line.line })} title={lineName(line)}>
          {shortLineName(line)}
        </option>
      ))}
    </SelectCell>
  );
}

/** ▲ Proposed with a Confirm button, ✓ Confirmed, Personal, or a dash when nothing is chosen. */
function StateCell({ category }: { category: TaxCategory }) {
  const { actions } = useRow();
  const state = taxCategoryState(category);
  if (state === "confirmed") return <td className={`${TD} text-income`}><span aria-hidden="true">✓ </span>Confirmed</td>;
  if (state === "personal") return <td className={`${TD} text-muted`}>Personal</td>;
  if (state === "none") return <td className={`${TD} text-muted`}>—</td>;
  // Saving the mapping as it stands is what confirms it; focus stays on that mapping as the button goes.
  const confirm = () => {
    actions.commit({ action: mapTaxCategoryAction, field: "mapping" });
    document.getElementById(mappingId(category))?.focus();
  };
  return (
    <td className={`${CELL} whitespace-nowrap pl-2.5 pr-1`}>
      <span className="text-muted">
        <span aria-hidden="true">▲ </span>Proposed
      </span>
      <button
        type="button"
        onClick={confirm}
        className="ml-2 inline-flex min-h-11 items-center rounded-md border border-income px-3 text-[14px] font-semibold text-income"
      >
        <span aria-hidden="true">✓ </span>Confirm<span className="sr-only"> the line for {category.name}</span>
      </button>
    </td>
  );
}

function RemoveStrip({ category, onKeep }: { category: TaxCategory; onKeep: () => void }) {
  const { actions } = useRow();
  return (
    <InlineConfirm
      colSpan={COLUMNS}
      question={`Remove ${category.name}? Items using it keep their place and lose only the category.`}
      confirmLabel="Remove"
      menuId={menuId(category)}
      gone={`Removed ${category.name}.`}
      onConfirm={() => actions.commit({ action: removeTaxCategoryAction })}
      onKeep={onKeep}
    />
  );
}

function NewCategoryRows() {
  const draft = useDraftRow(NEW_NAME_ID);
  return (
    <tbody>
      <NewRowLine id={draft.lineId} colSpan={COLUMNS} label="New category" hidden={draft.open} onOpen={draft.show} />
      <RowForm id="new-category" action={addTaxCategoryAction} draft>
        <Row hidden={!draft.open}>
          <NameCell
            id={NEW_NAME_ID}
            name="name"
            label="Name of the new tax category"
            rowName="New category"
            defaultValue=""
            maxLength={80}
            required
            placeholder="New category"
            className={STICKY_FIRST}
          />
          <BlankCells count={2} />
          <StatusCell />
          <CancelCell label="Close the new category row" onCancel={draft.hide} />
        </Row>
      </RowForm>
    </tbody>
  );
}
