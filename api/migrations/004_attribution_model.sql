-- Attribution model is selectable per client: first_click, last_click, or linear.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS attribution_model TEXT NOT NULL DEFAULT 'first_click';

ALTER TABLE clients
  ADD CONSTRAINT clients_attribution_model_check
  CHECK (attribution_model IN ('first_click', 'last_click', 'linear'));
