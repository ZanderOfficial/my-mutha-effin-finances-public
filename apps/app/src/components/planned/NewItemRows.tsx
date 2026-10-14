"use client";
// "+ New item": a draft row typed in place at the foot of the planned items; it posts on Enter or when left.

import { createItemAction } from "@/app/budget/planned-actions";
import { MoneyInputCell, NameCell, SelectCell, TagsCell, TextCell } from "@/components/table/cells";
import { BlankCells, CancelCell, NewRowLine, useDraftRow } from "@/components/table/NewRow";
import { Row, RowForm, StatusCell } from "@/components/table/RowForm";
import { STICKY_FIRST, TAG, TD } from "@/components/table/styles";
import { figureColumns, notesColumn, plannedColumnCount } from "./columns";
import { CategoryOptions, FrequencyOptions } from "./options";
import { usePlanned } from "./PlannedContext";

const NAME_ID = "new-item-name";

/** The draft row is always in the page, hidden until "+ New item" opens it, so what was typed survives closing it. */
export function NewItemRows() {
  const { period } = usePlanned();
  const draft = useDraftRow(NAME_ID);
  return (
    <tbody>
      <NewRowLine id={draft.lineId} colSpan={plannedColumnCount(period)} label="New item" hidden={draft.open} onOpen={draft.show} />
      <NewItemDraft hidden={!draft.open} onClose={draft.hide} />
    </tbody>
  );
}

/** On a business tab the new item starts tagged "For" that business; nothing else is filled in. */
function NewItemDraft({ hidden, onClose }: { hidden: boolean; onClose: () => void }) {
  const { period, categories, businesses, businessId } = usePlanned();
  return (
    <RowForm id="new-item" action={createItemAction} draft>
      <Row hidden={hidden}>
        <NameCell
          id={NAME_ID}
          name="name"
          label="Name of the new item"
          rowName="New item"
          defaultValue=""
          maxLength={120}
          required
          inset="item"
          placeholder="New item"
          className={STICKY_FIRST}
        />
        <MoneyInputCell name="amount" label="Amount for the new item" defaultValue="" placeholder="0.00" />
        <SelectCell name="frequency" label="How often the new item is paid" defaultValue={period === "annual" ? "annual" : "monthly"} className="max-md:hidden">
          <FrequencyOptions />
        </SelectCell>
        <BlankCells count={figureColumns(period)} />
        {businesses.length === 0 ? (
          <td className={TD}>
            <span className={TAG}>Personal</span>
          </td>
        ) : (
          <TagsCell name="businessId" label="Who the new item is for" businesses={businesses} checked={businessId ? [businessId] : []} idPrefix="new-for" />
        )}
        <SelectCell name="taxCategoryId" label="Tax category for the new item" defaultValue="">
          <CategoryOptions categories={categories} />
        </SelectCell>
        <BlankCells count={1} />
        <TextCell name="notes" label="Notes for the new item" defaultValue="" maxLength={500} className={notesColumn(period)} />
        <StatusCell />
        <CancelCell label="Close the new item row" onCancel={onClose} />
      </Row>
    </RowForm>
  );
}
