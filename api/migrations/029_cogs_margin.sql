-- True-profit inputs. Every report today computes profit as revenue - ad_cost only,
-- which overstates margin for any client with real product/fulfillment/processing
-- costs. These are account-wide percentage/flat assumptions (no per-SKU catalog is
-- synced from Shopify or anywhere else), matching how most attribution tools handle
-- true profit for stores that don't maintain a per-product cost catalog. All three
-- default to NULL/0 so an unconfigured client's numbers are unchanged from before.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS cogs_percent NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_fee_percent NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS fulfillment_cost_flat NUMERIC;
