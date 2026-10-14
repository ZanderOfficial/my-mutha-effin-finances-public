"use client";
// One top-level planned item and its sub-items, as one <tbody>: the ▸ folds the sub-items, and a draft row adds one.

import { useState } from "react";
import { addSubItemAction } from "@/app/budget/planned-actions";
import { MoneyInputCell, NameCell, SelectCell, TextCell } from "@/components/table/cells";
import { BlankCells, CancelCell, useDraftRow } from "@/components/table/NewRow";
import { HiddenField, Row, RowForm, StatusCell } from "@/components/table/RowForm";
import { menuButtonId } from "@/components/table/RowMenu";
import { STICKY_FIRST, TD } from "@/components/table/styles";
import type { PlannedRow } from "@/lib/planned-budget";
import { figureColumns, notesColumn, plannedColumnCount } from "./columns";
import { itemMenuId, itemRowId, ItemRow } from "./ItemRow";
import { CategoryOptions, FREQUENCY_WORD } from "./options";
import { usePlanned } from "./PlannedContext";

export function ItemGroup({ row }: { row: PlannedRow }) {
  const { item } = row;
  const [subItemsOpen, setSubItemsOpen] = useState(true);
  // Closing the draft returns focus to "+ Add a sub-item", or to the parent's ⋯ when it has no sub-items yet.
  const draft = useDraftRow(`new-sub-name-${item.id}`, menuButtonId(itemMenuId(item.id)));
  const hasSubItems = row.subItems.length > 0;
  const startAdding = () => {
    setSubItemsOpen(true);
    draft.show();
  };
  const toggle = hasSubItems
    ? { open: subItemsOpen, rowIds: row.subItems.map((sub) => itemRowId(sub.item.id)), onToggle: () => setSubItemsOpen((open) => !open) }
    : undefined;

  return (
    <tbody>
      <ItemRow row={row} subItems={toggle} onAddSubItem={startAdding} />
      {row.subItems.map((sub) => (
        <ItemRow key={sub.item.id} row={sub} hidden={!subItemsOpen} />
      ))}
      {draft.open && <SubItemDraft parent={row} nameId={`new-sub-name-${item.id}`} onClose={draft.hide} />}
      {!draft.open && hasSubItems && subItemsOpen && <AddSubItemLine id={draft.lineId} name={item.name} onAdd={startAdding} />}
    </tbody>
  );
}

/** The muted "+ Add a sub-item" line under an open parent's sub-items. */
function AddSubItemLine({ id, name, onAdd }: { id: string; name: string; onAdd: () => void }) {
  const { period } = usePlanned();
  return (
    <tr>
      <td colSpan={plannedColumnCount(period)} className="h-11 border-b border-rule/60 p-0">
        <button
          id={id}
          type="button"
          onClick={onAdd}
          className="flex min-h-11 w-full items-center gap-2 pl-21 text-left text-[14px] text-muted hover:bg-panel-raised hover:text-foreground focus-visible:-outline-offset-2"
        >
          <span aria-hidden="true">+</span> Add a sub-item<span className="sr-only"> to {name}</span>
        </button>
      </td>
    </tr>
  );
}

/** A new sub-item, typed in place under its parent. It takes the parent's frequency and For tags. */
function SubItemDraft({ parent, nameId, onClose }: { parent: PlannedRow; nameId: string; onClose: () => void }) {
  const { period, categories } = usePlanned();
  const { item } = parent;
  return (
    <RowForm id={`new-sub-${item.id}`} action={addSubItemAction} draft>
      <Row>
        <NameCell
          id={nameId}
          name="name"
          label={`Name of a new sub-item of ${item.name}`}
          rowName={`New sub-item of ${item.name}`}
          defaultValue=""
          maxLength={120}
          required
          inset="sub-item"
          placeholder="New sub-item"
          className={STICKY_FIRST}
        />
        <MoneyInputCell name="amount" label={`Amount for the new sub-item, ${item.frequency}`} defaultValue="" placeholder="0.00" />
        <td className={`${TD} text-muted max-md:hidden`}>
          <span aria-hidden="true">↳ </span>
          {FREQUENCY_WORD[item.frequency]}
        </td>
        <BlankCells count={figureColumns(period)} />
        <td className={`${TD} text-muted`}>
          <span aria-hidden="true">↳ </span>As parent
        </td>
        <SelectCell name="taxCategoryId" label="Tax category for the new sub-item" defaultValue={item.taxCategoryId ?? ""}>
          <CategoryOptions categories={categories} />
        </SelectCell>
        <BlankCells count={1} />
        <TextCell name="notes" label="Notes for the new sub-item" defaultValue="" maxLength={500} className={notesColumn(period)} />
        <StatusCell>
          <HiddenField name="parentId" value={item.id} />
        </StatusCell>
        <CancelCell label={`Stop adding a sub-item to ${item.name}`} onCancel={onClose} />
      </Row>
    </RowForm>
  );
}
