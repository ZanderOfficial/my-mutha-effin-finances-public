-- 0008: Schedule C expense lines as reference data, and the owner's mapping of each tax category to one.

-- Reference rows belong to no owner, so they live outside public, where every table needs an owner and RLS.
CREATE SCHEMA IF NOT EXISTS reference;
REVOKE ALL ON SCHEMA reference FROM PUBLIC;
GRANT USAGE ON SCHEMA reference TO mmff_app;

-- One row per Part II expense line, copied from the printed form. A new tax year adds new rows.
CREATE TABLE reference.schedule_c_lines (
  tax_year   smallint NOT NULL,
  line       text NOT NULL,
  heading    text,
  label      text NOT NULL,
  position   smallint NOT NULL,
  source_url text NOT NULL,
  checked_on date NOT NULL,
  PRIMARY KEY (tax_year, line),
  UNIQUE (tax_year, position)
);

-- The runtime role reads the lines and can never change them.
GRANT SELECT ON reference.schedule_c_lines TO mmff_app;

-- Schedule C (Form 1040) 2025, Part II, as printed (Cat. No. 11334P), checked 2026-10-09.
INSERT INTO reference.schedule_c_lines (tax_year, line, heading, label, position, source_url, checked_on) VALUES
  (2025, '8',   NULL, 'Advertising', 1, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '9',   NULL, 'Car and truck expenses (see instructions)', 2, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '10',  NULL, 'Commissions and fees', 3, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '11',  NULL, 'Contract labor (see instructions)', 4, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '12',  NULL, 'Depletion', 5, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '13',  NULL, 'Depreciation and section 179 expense deduction (not included in Part III) (see instructions)', 6, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '14',  NULL, 'Employee benefit programs (other than on line 19)', 7, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '15',  NULL, 'Insurance (other than health)', 8, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '16a', 'Interest (see instructions):', 'Mortgage (paid to banks, etc.)', 9, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '16b', 'Interest (see instructions):', 'Other', 10, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '17',  NULL, 'Legal and professional services', 11, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '18',  NULL, 'Office expense (see instructions)', 12, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '19',  NULL, 'Pension and profit-sharing plans', 13, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '20a', 'Rent or lease (see instructions):', 'Vehicles, machinery, and equipment', 14, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '20b', 'Rent or lease (see instructions):', 'Other business property', 15, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '21',  NULL, 'Repairs and maintenance', 16, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '22',  NULL, 'Supplies (not included in Part III)', 17, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '23',  NULL, 'Taxes and licenses', 18, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '24a', 'Travel and meals:', 'Travel', 19, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '24b', 'Travel and meals:', 'Deductible meals (see instructions)', 20, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '25',  NULL, 'Utilities', 21, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '26',  NULL, 'Wages (less employment credits)', 22, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '27a', NULL, 'Energy efficient commercial bldgs deduction (attach Form 7205)', 23, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '27b', NULL, 'Other expenses (from line 48)', 24, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09'),
  (2025, '30',  NULL, 'Expenses for business use of your home', 25, 'https://www.irs.gov/pub/irs-pdf/f1040sc.pdf', '2026-10-09');

-- Each category goes on one Schedule C line, or is personal, or is not mapped yet.
-- mapping_confirmed stays false while a mapping is only the app's proposal.
ALTER TABLE tax_categories
  ADD COLUMN schedule_c_year smallint,
  ADD COLUMN schedule_c_line text,
  ADD COLUMN personal boolean NOT NULL DEFAULT false,
  ADD COLUMN mapping_confirmed boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT tax_categories_line_fkey FOREIGN KEY (schedule_c_year, schedule_c_line)
    REFERENCES reference.schedule_c_lines (tax_year, line),
  ADD CONSTRAINT tax_categories_line_pair CHECK ((schedule_c_year IS NULL) = (schedule_c_line IS NULL)),
  ADD CONSTRAINT tax_categories_line_or_personal CHECK (NOT personal OR schedule_c_line IS NULL);
