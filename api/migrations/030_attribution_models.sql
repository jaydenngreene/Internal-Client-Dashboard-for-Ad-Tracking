-- Adds time_decay (7-day half-life, recency-weighted) and u_shaped
-- (40% first touch / 40% last touch / 20% split across the middle) alongside the
-- existing first_click/last_click/linear models.
ALTER TABLE clients DROP CONSTRAINT clients_attribution_model_check;
ALTER TABLE clients ADD CONSTRAINT clients_attribution_model_check
  CHECK (attribution_model IN ('first_click', 'last_click', 'linear', 'time_decay', 'u_shaped'));
