-- Ergänzt Buchungen um die abgelegte Verkaufs-PDF und den erkannten Text.
-- Sicher erneut ausführbar; vorhandene Buchungen werden nicht verändert.
alter table public.bookings
  add column if not exists source_document_path text,
  add column if not exists source_document_name text,
  add column if not exists source_document_ocr_text text;
