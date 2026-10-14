-- 0007: the owner's planned budget (M8): items with one level of sub-items, business tags and tax categories.

-- The owner's own tax categories. M8's next migration maps each one to a Schedule C line.
CREATE TABLE tax_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   text NOT NULL,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name),
  UNIQUE (owner_id, id)
);

-- What the owner intends to pay. parent_id makes a row a sub-item of another.
CREATE TABLE planned_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        text NOT NULL,
  parent_id       uuid,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),
  frequency       text NOT NULL CHECK (frequency IN ('monthly', 'annual')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'not_paying')),
  notes           text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  tax_category_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, id),
  UNIQUE (owner_id, id, frequency),
  CHECK (parent_id IS NULL OR parent_id <> id),
  -- A sub-item shares its parent's frequency; changing the parent's carries to its sub-items.
  FOREIGN KEY (owner_id, parent_id, frequency) REFERENCES planned_items (owner_id, id, frequency)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (owner_id, tax_category_id) REFERENCES tax_categories (owner_id, id)
    ON DELETE SET NULL (tax_category_id)
);

CREATE INDEX planned_items_parent ON planned_items (owner_id, parent_id);

-- "For": the businesses an item serves. No row means personal. A shared cost is tagged, not split.
CREATE TABLE planned_item_businesses (
  item_id     uuid NOT NULL,
  business_id uuid NOT NULL,
  owner_id    text NOT NULL,
  PRIMARY KEY (item_id, business_id),
  FOREIGN KEY (owner_id, item_id) REFERENCES planned_items (owner_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, business_id) REFERENCES businesses (owner_id, id) ON DELETE CASCADE
);

-- Sub-items go one level deep: a sub-item cannot have sub-items, and an item with sub-items cannot become one.
CREATE FUNCTION private.planned_items_one_level() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.planned_items p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a sub-item cannot have sub-items' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.planned_items c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'an item with sub-items cannot become a sub-item' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER planned_items_one_level
  BEFORE INSERT OR UPDATE OF parent_id ON planned_items
  FOR EACH ROW EXECUTE FUNCTION private.planned_items_one_level();

-- Row-level security, as in 0002.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_categories', 'planned_items', 'planned_item_businesses']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON public.%I FOR ALL '
      'USING (owner_id = current_setting(''app.owner_id'', true)) '
      'WITH CHECK (owner_id = current_setting(''app.owner_id'', true))',
      t
    );
  END LOOP;
END $$;
