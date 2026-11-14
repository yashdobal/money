-- Phase 2: what the app needs to rebuild exactly what the Apps Script dashboard reads.
alter table transactions  add column if not exists sheet_row integer;      -- row order in the Sheet
alter table card_emails   add column if not exists sheet_row integer;
alter table card_payments add column if not exists sheet_row integer,      -- order in App data "payments"
                          add column if not exists account_label text;     -- the label as entered ('shopper', 'Lotus Credit Card XX3333')
