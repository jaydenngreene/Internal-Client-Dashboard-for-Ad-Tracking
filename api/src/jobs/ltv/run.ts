import { db } from '../../db'

// Recomputes revenue_30d/60d/90d/180d for every customer_ltv row in one pass, as of
// now — these are trailing-window snapshots, not cumulative totals, so a customer
// whose last order has aged out of a window gets reset back to 0 in that column.
// Refunded purchases are excluded, matching how recordRefund already treats
// revenue_lifetime. Rows are only ever created by recordPurchase (i.e. only for
// customers who have ad-history attribution) — this job never creates new rows.
export async function refreshCustomerLtv(): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE customer_ltv cl
     SET revenue_30d   = agg.revenue_30d,
         revenue_60d   = agg.revenue_60d,
         revenue_90d   = agg.revenue_90d,
         revenue_180d  = agg.revenue_180d,
         last_updated  = NOW()
     FROM (
       SELECT
         client_id,
         email,
         COALESCE(SUM(revenue) FILTER (WHERE purchased_at >= NOW() - INTERVAL '30 days' AND NOT refunded), 0)  AS revenue_30d,
         COALESCE(SUM(revenue) FILTER (WHERE purchased_at >= NOW() - INTERVAL '60 days' AND NOT refunded), 0)  AS revenue_60d,
         COALESCE(SUM(revenue) FILTER (WHERE purchased_at >= NOW() - INTERVAL '90 days' AND NOT refunded), 0)  AS revenue_90d,
         COALESCE(SUM(revenue) FILTER (WHERE purchased_at >= NOW() - INTERVAL '180 days' AND NOT refunded), 0) AS revenue_180d
       FROM purchases
       GROUP BY client_id, email
     ) agg
     WHERE cl.client_id = agg.client_id AND cl.email = agg.email`
  )
  return rowCount ?? 0
}

if (require.main === module) {
  refreshCustomerLtv()
    .then((count) => {
      console.log(`Refreshed LTV windows for ${count} customer row(s)`)
      return db.end()
    })
    .catch((err) => {
      console.error('LTV refresh failed:', err)
      process.exit(1)
    })
}
