"use client";
// One planned item as a table row: edited in place, its charges nested under it, its ⋯ menu at the end.

import { useState } from "react";
import { deleteItemAction, setItemStatusAction, updateItemAction } from "@/app/budget/planned-actions";
import { Money } from "@/components/Money";
import { MoneyInputCell, NameCell, SelectCell, TagsCell, TextCell } from "@/components/table/cells";
import { StateText } from "@/components/table/DataTable";
import { ExpandButton } from "@/components/table/Disclosure";
import { HiddenField, Row, RowForm, StatusCell, useRow } from "@/components/table/RowForm";
import { InlineConfirm, MenuItem, MenuRule, RowMenu } from "@/components/table/RowMenu";
import { CELL, CHARGES_SLOT, GUTTER_BUTTON, NUM, STICKY_FIRST, TAG, TD } from "@/components/table/styles";
import { actualOf } from "@/lib/actuals";
import { itemPosts, planStandingOf, type StateWords } from "@/lib/budget-table";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { centsToCellInput } from "@/lib/money-input";
import type { PlannedRow } from "@/lib/planned-budget";
import { notesColumn, plannedColumnCount } from "./columns";
import { MatchRows } from "./MatchRows";
import { CategoryOptions, FREQUENCY_WORD, FrequencyOptions } from "./options";
import { usePlanned } from "./PlannedContext";

/** A parent's ▸ for its sub-items: whether they show, which rows they are, and how to toggle them. */
export type SubItemToggle = { open: boolean; rowIds: string[]; onToggle: () => void };

/** The id of an item's table row, which a parent's ▸ points at. */
export const itemRowId = (itemId: string) => `item-row-${itemId}`;

/** The id of an item's ⋯ menu. */
export const itemMenuId = (itemId: string) => `menu-${itemId}`;

/** Every input stays in the row whatever is shown, because updateItem replaces the For tags and the notes. */
export function ItemRow({
  row,
  hidden = false,
  subItems,
  onAddSubItem,
}: {
  row: PlannedRow;
  /** A sub-item whose parent is folded away. */
  hidden?: boolean;
  subItems?: SubItemToggle;
  /** Top-level rows only: opens a draft sub-item row. */
  onAddSubItem?: () => void;
}) {
  const { item } = row;
  const { period, actuals, categories } = usePlanned();
  const [chargesOpen, setChargesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const charges = actuals.matchedByItem[item.id] ?? [];
  const chargesId = `charges-${item.id}`;
  const toggleCharges = () => setChargesOpen((open) => !open);
  const verdict = standingWords(row, actualOf(actuals, item.id));

  return (
    <RowForm id={`item-${item.id}`} action={updateItemAction}>
      <Row id={itemRowId(item.id)} hidden={hidden || confirming} className={row.counts ? "" : "text-muted [&_.cell-input]:text-muted"}>
        <ItemNameCell row={row} subItems={subItems} verdict={verdict} />
        <AmountCell row={row} />
        <FrequencyCell row={row} />
        {period === "annual" && <YearCell row={row} />}
        <SpentCell row={row} count={charges.length} open={chargesOpen} controls={chargesId} onToggle={toggleCharges} />
        <StandingCell row={row} verdict={verdict} />
        <ForCell row={row} />
        <SelectCell name="taxCategoryId" label={`Tax category for ${item.name}`} defaultValue={item.taxCategoryId ?? ""}>
          <CategoryOptions categories={categories} />
        </SelectCell>
        <PayingCell paying={item.status === "active"} />
        <TextCell name="notes" label={`Notes for ${item.name}`} defaultValue={item.notes} maxLength={500} className={notesColumn(period)} />
        <StatusCell>
          <HiddenField name="itemId" value={item.id} />
        </StatusCell>
        <ItemMenu row={row} hasCharges={charges.length > 0} chargesOpen={chargesOpen} onToggleCharges={toggleCharges} onAddSubItem={onAddSubItem} onDelete={() => setConfirming(true)} />
      </Row>
      {confirming && <DeleteStrip row={row} colSpan={plannedColumnCount(period)} onKeep={() => setConfirming(false)} />}
      {charges.length > 0 && (
        <MatchRows id={chargesId} colSpan={plannedColumnCount(period)} label={`Charges matched to ${item.name}`} transactions={charges} hidden={hidden || !chargesOpen} />
      )}
    </RowForm>
  );
}

/** The row's name as its header, with the ▸ for its sub-items in the gutter and, on a phone, its standing underneath. */
function ItemNameCell({ row, subItems, verdict }: { row: PlannedRow; subItems?: SubItemToggle; verdict: StateWords }) {
  const { item } = row;
  const sub = item.parentId !== null;
  const toggle = subItems && (
    <ExpandButton expanded={subItems.open} controls={subItems.rowIds.join(" ")} label={`Sub-items of ${item.name}`} onToggle={subItems.onToggle} className={GUTTER_BUTTON} />
  );
  return (
    <NameCell
      name="name"
      label={sub ? `Name of sub-item ${item.name}` : `Name of ${item.name}`}
      rowName={item.name}
      defaultValue={item.name}
      maxLength={120}
      required
      inset={sub ? "sub-item" : "item"}
      toggle={toggle}
      phoneLine={<StateText state={verdict} />}
      className={STICKY_FIRST}
    />
  );
}

/** A parent's amount is its paying sub-items' total, so it is shown, never typed. */
function AmountCell({ row }: { row: PlannedRow }) {
  const { item } = row;
  if (itemPosts(item, row.subItems.length).amount) {
    return <MoneyInputCell name="amount" label={`Amount for ${item.name}`} defaultValue={centsToCellInput(item.amountCents)} />;
  }
  const paying = row.subItems.filter((sub) => sub.item.status === "active").length;
  return (
    <td className={`${TD} ${NUM}`} title={`The total of the ${plural(paying, "sub-item")} being paid`}>
      <span aria-hidden="true" className="text-muted">
        Σ{" "}
      </span>
      <Money cents={row.amountCents} />
      <span className="sr-only"> from {plural(paying, "sub-item")}</span>
    </td>
  );
}

/** A sub-item is paid as often as its parent, so it shows that frequency without offering it. Off on a phone, still posted. */
function FrequencyCell({ row }: { row: PlannedRow }) {
  const { item } = row;
  if (itemPosts(item, row.subItems.length).frequency) {
    return (
      <SelectCell name="frequency" label={`How often ${item.name} is paid`} defaultValue={item.frequency} className="max-md:hidden">
        <FrequencyOptions />
      </SelectCell>
    );
  }
  return (
    <td className={`${TD} text-muted max-md:hidden`}>
      <span aria-hidden="true">↳ </span>
      {FREQUENCY_WORD[item.frequency]}
    </td>
  );
}

/** The Annual view's Planned column: a monthly item twelve times over. */
function YearCell({ row }: { row: PlannedRow }) {
  const twelve = row.viewAmountCents !== row.amountCents;
  return (
    <td className={`${TD} ${NUM}`}>
      {twelve && (
        <span aria-hidden="true" className="mr-0.5 text-[12px] text-muted">
          ×12
        </span>
      )}
      <Money cents={row.viewAmountCents} />
      {twelve && <span className="sr-only">, twelve months</span>}
    </td>
  );
}

/** What was really spent in the view's period, with the count of charges that opens them underneath. */
function SpentCell({
  row,
  count,
  open,
  controls,
  onToggle,
}: {
  row: PlannedRow;
  count: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const { actuals } = usePlanned();
  const actual = actualOf(actuals, row.item.id);
  return (
    <td className={`${CELL} whitespace-nowrap pl-2.5 pr-1 ${NUM}`}>
      <span className={actual === null ? "text-muted" : ""}>
        <Money cents={actual} />
      </span>
      {count > 0 ? (
        <ChargesButton count={count} name={row.item.name} open={open} controls={controls} onToggle={onToggle} />
      ) : (
        <span aria-hidden="true" className={`inline-block ${CHARGES_SLOT}`} />
      )}
    </td>
  );
}

/** The count of matched charges as a button; the words a screen reader hears name the item. */
export function ChargesButton({
  count,
  name,
  open,
  controls,
  onToggle,
}: {
  count: number;
  name: string;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <ExpandButton
      expanded={open}
      controls={controls}
      label={`${plural(count, "matched transaction")} for ${name}`}
      onToggle={onToggle}
      className={cn(CHARGES_SLOT, "min-w-12 px-2 text-[13px]")}
    >
      <span aria-hidden="true" className="underline underline-offset-2">
        {count}
      </span>
      <span className="sr-only">
        {plural(count, "matched transaction")} for {name}
      </span>
    </ExpandButton>
  );
}

/** Planned against spent in words. A row that counts nowhere says so; an unknown one is a dash. */
function standingWords(row: PlannedRow, actual: number | null): StateWords {
  if (!row.counts) return { glyph: "", words: "Counts in no total", tone: "muted" };
  return planStandingOf(row.viewAmountCents, actual) ?? { glyph: "", words: "—", tone: "muted" };
}

function StandingCell({ row, verdict }: { row: PlannedRow; verdict: StateWords }) {
  const why = row.item.status === "not_paying" ? "Not currently paying" : "Its parent is not being paid";
  return (
    <td className={`${CELL} px-2.5 leading-tight`} title={row.counts ? undefined : `${why}, so it counts in no total.`}>
      <StateText state={verdict} className="whitespace-nowrap" />
    </td>
  );
}

/** "For": the businesses a cost serves. A sub-item is for whatever its parent is for. */
function ForCell({ row }: { row: PlannedRow }) {
  const { businesses, businessId } = usePlanned();
  const { item } = row;
  if (!itemPosts(item, row.subItems.length).forTags) {
    return (
      <td className={`${TD} text-muted`}>
        <span aria-hidden="true">↳ </span>As parent
      </td>
    );
  }
  if (businesses.length === 0) {
    return (
      <td className={TD}>
        <span className={TAG}>Personal</span>
      </td>
    );
  }
  const shared = businessId !== null && row.shared ? `Shared ×${item.businessIds.length}` : undefined;
  return <TagsCell name="businessId" label={`Who ${item.name} is for`} businesses={businesses} checked={item.businessIds} idPrefix={`for-${item.id}`} summary={shared} />;
}

function PayingCell({ paying }: { paying: boolean }) {
  return (
    <td className={`${TD} ${paying ? "" : "text-muted"}`}>
      <span aria-hidden="true">{paying ? "● " : "○ "}</span>
      {paying ? "Paying" : "Not paying"}
    </td>
  );
}

/** The ⋯ menu: pause or resume, add a sub-item, show the charges, delete. */
function ItemMenu({
  row,
  hasCharges,
  chargesOpen,
  onToggleCharges,
  onAddSubItem,
  onDelete,
}: {
  row: PlannedRow;
  hasCharges: boolean;
  chargesOpen: boolean;
  onToggleCharges: () => void;
  onAddSubItem?: () => void;
  onDelete: () => void;
}) {
  const { actions } = useRow();
  const { item } = row;
  const paying = item.status === "active";
  const setStatus = () => actions.commit({ action: setItemStatusAction, extra: { status: paying ? "not_paying" : "active" } });
  return (
    <RowMenu id={itemMenuId(item.id)} label={`Menu for ${item.name}`}>
      <MenuItem onSelect={setStatus}>{paying ? "Stop paying (keep the row)" : "Resume paying"}</MenuItem>
      {onAddSubItem && <MenuItem onSelect={onAddSubItem}>Add a sub-item</MenuItem>}
      {hasCharges && <MenuItem onSelect={onToggleCharges}>{chargesOpen ? "Hide matched charges" : "Show matched charges"}</MenuItem>}
      <MenuRule />
      <MenuItem onSelect={onDelete} danger>
        Delete…
      </MenuItem>
    </RowMenu>
  );
}

/** "Delete Rent and its 3 sub-items?" in place of the row. A top-level item takes its sub-items with it. */
function DeleteStrip({ row, colSpan, onKeep }: { row: PlannedRow; colSpan: number; onKeep: () => void }) {
  const { actions } = useRow();
  const { item } = row;
  const count = row.subItems.length;
  const question = count > 0 ? `Delete ${item.name} and its ${plural(count, "sub-item")}?` : `Delete ${item.name}?`;
  const remove = () => actions.commit({ action: deleteItemAction, extra: count > 0 ? { withSubItems: "1" } : {} });
  return (
    <InlineConfirm
      colSpan={colSpan}
      question={question}
      confirmLabel="Delete"
      menuId={itemMenuId(item.id)}
      removes={item.parentId === null ? "group" : "row"}
      gone={`Deleted ${item.name}.`}
      onConfirm={remove}
      onKeep={onKeep}
    />
  );
}

