"use client";
// A list of the owner's own names as a table (businesses, one-time kinds): each renamed in place, removed with an inline confirm, and "+ New".

import { useState } from "react";
import { NameCell } from "@/components/table/cells";
import { Column, DataTable, EmptyRow } from "@/components/table/DataTable";
import { CancelCell, NewRowLine, useDraftRow } from "@/components/table/NewRow";
import { RemovalNotice } from "@/components/table/removal";
import { HiddenField, Row, RowForm, StatusCell, useRow } from "@/components/table/RowForm";
import { InlineConfirm, MenuItem, RowMenu } from "@/components/table/RowMenu";
import type { ActionState } from "@/server/owner-write";

const COLUMNS = 3;
const MAX_NAME = 60;

type Action = (previous: ActionState, form: FormData) => Promise<ActionState>;
type Named = { id: string; name: string };

/** What differs between lists: their words, the id field the actions read, and the actions. */
export type NameListSpec = {
  /** "business", "one-time kind": used in labels and the "+ New" row. */
  noun: string;
  /** The table's accessible name, e.g. "Businesses". */
  label: string;
  /** The form field the rename and remove actions read the id from. */
  idField: string;
  /** Starts every element id in the list, e.g. "business". */
  prefix: string;
  placeholder: string;
  /** What removing one does, said in the confirm, e.g. "Its income becomes personal." */
  removeWords: string;
  add: Action;
  rename: Action;
  remove: Action;
};

export function NameList({ spec, items }: { spec: NameListSpec; items: Named[] }) {
  return (
    <RemovalNotice>
      <DataTable label={spec.label}>
        <thead>
          <tr>
            <Column kind="text" className="w-full">
              Name
            </Column>
            <Column srOnly className="w-18 min-w-18">
              Save state
            </Column>
            <Column srOnly className="w-11">
              Row menu
            </Column>
          </tr>
        </thead>
        {items.length === 0 ? (
          <EmptyRow colSpan={COLUMNS} />
        ) : (
          <tbody>
            {items.map((item) => (
              <NameRow key={item.id} spec={spec} item={item} />
            ))}
          </tbody>
        )}
        <NewNameRows spec={spec} />
      </DataTable>
    </RemovalNotice>
  );
}

const menuId = (spec: NameListSpec, item: Named) => `${spec.prefix}-menu-${item.id}`;

function NameRow({ spec, item }: { spec: NameListSpec; item: Named }) {
  const [removing, setRemoving] = useState(false);
  return (
    <RowForm id={`${spec.prefix}-${item.id}`} action={spec.rename}>
      <Row hidden={removing}>
        <NameCell name="name" label={`Name of ${item.name}`} rowName={item.name} defaultValue={item.name} maxLength={MAX_NAME} required />
        <StatusCell>
          <HiddenField name={spec.idField} value={item.id} />
        </StatusCell>
        <RowMenu id={menuId(spec, item)} label={`Menu for ${item.name}`}>
          <MenuItem onSelect={() => setRemoving(true)} danger>
            Remove…
          </MenuItem>
        </RowMenu>
      </Row>
      {removing && <RemoveStrip spec={spec} item={item} onKeep={() => setRemoving(false)} />}
    </RowForm>
  );
}

function RemoveStrip({ spec, item, onKeep }: { spec: NameListSpec; item: Named; onKeep: () => void }) {
  const { actions } = useRow();
  return (
    <InlineConfirm
      colSpan={COLUMNS}
      question={`Remove ${item.name}? ${spec.removeWords}`}
      confirmLabel="Remove"
      menuId={menuId(spec, item)}
      gone={`Removed ${item.name}.`}
      onConfirm={() => actions.commit({ action: spec.remove })}
      onKeep={onKeep}
    />
  );
}

function NewNameRows({ spec }: { spec: NameListSpec }) {
  const nameId = `new-${spec.prefix}-name`;
  const draft = useDraftRow(nameId);
  return (
    <tbody>
      <NewRowLine id={draft.lineId} colSpan={COLUMNS} label={`New ${spec.noun}`} hidden={draft.open} onOpen={draft.show} />
      <RowForm id={`new-${spec.prefix}`} action={spec.add} draft>
        <Row hidden={!draft.open}>
          <NameCell
            id={nameId}
            name="name"
            label={`Name of the new ${spec.noun}`}
            rowName={`New ${spec.noun}`}
            defaultValue=""
            maxLength={MAX_NAME}
            required
            placeholder={spec.placeholder}
          />
          <StatusCell />
          <CancelCell label={`Close the new ${spec.noun} row`} onCancel={draft.hide} />
        </Row>
      </RowForm>
    </tbody>
  );
}
