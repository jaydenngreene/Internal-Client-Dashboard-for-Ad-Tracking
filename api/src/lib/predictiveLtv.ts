import { db } from '../db'

// Cohort-curve extrapolation, not a trained ML model — deliberately, for a
// single-operator tool this size. Computes, from THIS client's own customers who
// have already aged past a window, the average ratio of what they went on to
// spend vs. what they'd spent by an earlier window, then applies that same ratio
// to project a younger customer's eventual lifetime value. Returns null wherever
// there isn't enough of this client's own history to trust the ratio — an honest
// "not enough data yet" rather than a guessed number.
const MIN_SAMPLE_SIZE = 5

export interface MaturityCurve {
  multiplier180From30: number | null
  multiplierLifetimeFrom180: number | null
  sampleSize180: number
  sampleSizeLifetime: number
}

export async function computeMaturityCurve(clientId: string): Promise<MaturityCurve> {
  const [row180, rowLifetime] = await Promise.all([
    db.query<{ ratio: string | null; n: string }>(
      `SELECT AVG(revenue_180d / NULLIF(revenue_30d, 0)) AS ratio, COUNT(*) AS n
       FROM customer_ltv
       WHERE client_id = $1 AND first_purchase_date <= NOW() - INTERVAL '180 days' AND revenue_30d > 0`,
      [clientId]
    ),
    db.query<{ ratio: string | null; n: string }>(
      `SELECT AVG(revenue_lifetime / NULLIF(revenue_180d, 0)) AS ratio, COUNT(*) AS n
       FROM customer_ltv
       WHERE client_id = $1 AND first_purchase_date <= NOW() - INTERVAL '365 days' AND revenue_180d > 0`,
      [clientId]
    ),
  ])

  const n180 = parseInt(row180.rows[0].n, 10)
  const nLifetime = parseInt(rowLifetime.rows[0].n, 10)

  return {
    multiplier180From30: n180 >= MIN_SAMPLE_SIZE && row180.rows[0].ratio !== null ? parseFloat(row180.rows[0].ratio) : null,
    multiplierLifetimeFrom180:
      nLifetime >= MIN_SAMPLE_SIZE && rowLifetime.rows[0].ratio !== null ? parseFloat(rowLifetime.rows[0].ratio) : null,
    sampleSize180: n180,
    sampleSizeLifetime: nLifetime,
  }
}

export interface CustomerLtvSnapshot {
  revenue_30d: number
  revenue_180d: number
  revenue_lifetime: number
  first_purchase_date: string | Date
}

// Uses whichever window this customer has actually aged past. A customer past
// 365 days has no "prediction" left to make — revenue_lifetime already reflects
// it as accurately as this app's data ever will.
export function predictLifetimeValue(curve: MaturityCurve, customer: CustomerLtvSnapshot): number | null {
  const ageDays = (Date.now() - new Date(customer.first_purchase_date).getTime()) / (1000 * 60 * 60 * 24)

  if (ageDays >= 365) return customer.revenue_lifetime
  if (ageDays >= 180) {
    return curve.multiplierLifetimeFrom180 === null ? null : customer.revenue_180d * curve.multiplierLifetimeFrom180
  }
  if (curve.multiplier180From30 === null || curve.multiplierLifetimeFrom180 === null) return null
  const predicted180 = customer.revenue_30d * curve.multiplier180From30
  return predicted180 * curve.multiplierLifetimeFrom180
}
