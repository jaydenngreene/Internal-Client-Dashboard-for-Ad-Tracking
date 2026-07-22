import { db } from '../db'

export interface GeoLiftTest {
  id: string
  client_id: string
  platform: string
  campaign_name: string
  holdout_regions: string[]
  pre_period_days: number
  test_start: string
  test_end: string
  created_at: string
}

// The actual statistical method true geo-lift testing uses — difference-in-
// differences — is the reason this is more rigorous than Step 45's simple pause
// test. That method just compared actual-vs-projected total revenue during a
// pause, which can't distinguish "the ads caused this" from "something else
// changed for everyone at the same time" (a seasonal dip, a site outage). DiD
// controls for that: it looks at how much MORE (or less) the treatment regions'
// per-session revenue changed compared to the holdout regions' own change over
// the same two periods — a common trend affecting both groups equally cancels
// out entirely.
export interface GeoLiftResult {
  status: 'pending' | 'running' | 'completed'
  preHoldoutRevenuePerSession: number
  preTreatmentRevenuePerSession: number
  duringHoldoutRevenuePerSession: number | null
  duringTreatmentRevenuePerSession: number | null
  didEstimate: number | null // the actual lift attributable to the campaign, per session
  holdoutSessions: number
  treatmentSessions: number
}

async function revenuePerSession(
  clientId: string,
  fromDate: string,
  toDate: string,
  holdoutRegions: string[],
  wantHoldout: boolean
): Promise<{ revenue: number; sessions: number }> {
  const regionFilter = wantHoldout ? `s.region = ANY($4)` : `(s.region IS NULL OR NOT (s.region = ANY($4)))`
  const { rows } = await db.query<{ revenue: string; sessions: string }>(
    `SELECT COALESCE(SUM(a.attributed_revenue), 0) AS revenue, COUNT(DISTINCT s.id) AS sessions
     FROM sessions s
     LEFT JOIN attributions a ON a.session_id = s.id
     LEFT JOIN purchases p ON p.id = a.purchase_id AND p.purchased_at::date BETWEEN $2 AND $3
     WHERE s.client_id = $1 AND s.started_at::date BETWEEN $2 AND $3 AND ${regionFilter}`,
    [clientId, fromDate, toDate, holdoutRegions]
  )
  return { revenue: parseFloat(rows[0].revenue), sessions: parseInt(rows[0].sessions, 10) }
}

export async function computeGeoLiftResult(test: GeoLiftTest): Promise<GeoLiftResult> {
  const today = new Date().toISOString().slice(0, 10)
  const status: GeoLiftResult['status'] =
    today < test.test_start ? 'pending' : today <= test.test_end ? 'running' : 'completed'

  const preStart = new Date(test.test_start + 'T00:00:00Z')
  preStart.setUTCDate(preStart.getUTCDate() - test.pre_period_days)
  const preEnd = new Date(test.test_start + 'T00:00:00Z')
  preEnd.setUTCDate(preEnd.getUTCDate() - 1)
  const preStartStr = preStart.toISOString().slice(0, 10)
  const preEndStr = preEnd.toISOString().slice(0, 10)

  const [preHoldout, preTreatment] = await Promise.all([
    revenuePerSession(test.client_id, preStartStr, preEndStr, test.holdout_regions, true),
    revenuePerSession(test.client_id, preStartStr, preEndStr, test.holdout_regions, false),
  ])
  const preHoldoutRps = preHoldout.sessions > 0 ? preHoldout.revenue / preHoldout.sessions : 0
  const preTreatmentRps = preTreatment.sessions > 0 ? preTreatment.revenue / preTreatment.sessions : 0

  if (status === 'pending') {
    return {
      status,
      preHoldoutRevenuePerSession: preHoldoutRps,
      preTreatmentRevenuePerSession: preTreatmentRps,
      duringHoldoutRevenuePerSession: null,
      duringTreatmentRevenuePerSession: null,
      didEstimate: null,
      holdoutSessions: preHoldout.sessions,
      treatmentSessions: preTreatment.sessions,
    }
  }

  const duringEnd = status === 'running' ? today : test.test_end
  const [duringHoldout, duringTreatment] = await Promise.all([
    revenuePerSession(test.client_id, test.test_start, duringEnd, test.holdout_regions, true),
    revenuePerSession(test.client_id, test.test_start, duringEnd, test.holdout_regions, false),
  ])
  const duringHoldoutRps = duringHoldout.sessions > 0 ? duringHoldout.revenue / duringHoldout.sessions : 0
  const duringTreatmentRps = duringTreatment.sessions > 0 ? duringTreatment.revenue / duringTreatment.sessions : 0

  const didEstimate = duringTreatmentRps - preTreatmentRps - (duringHoldoutRps - preHoldoutRps)

  return {
    status,
    preHoldoutRevenuePerSession: preHoldoutRps,
    preTreatmentRevenuePerSession: preTreatmentRps,
    duringHoldoutRevenuePerSession: duringHoldoutRps,
    duringTreatmentRevenuePerSession: duringTreatmentRps,
    didEstimate,
    holdoutSessions: preHoldout.sessions + duringHoldout.sessions,
    treatmentSessions: preTreatment.sessions + duringTreatment.sessions,
  }
}

export async function createGeoLiftTest(
  clientId: string,
  input: {
    platform: string
    campaignName: string
    holdoutRegions: string[]
    testStart: string
    testEnd: string
    prePeriodDays?: number
  }
): Promise<GeoLiftTest> {
  const { rows } = await db.query<GeoLiftTest>(
    `INSERT INTO geo_lift_tests (client_id, platform, campaign_name, holdout_regions, pre_period_days, test_start, test_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, client_id, platform, campaign_name, holdout_regions, pre_period_days, test_start::text, test_end::text, created_at`,
    [clientId, input.platform, input.campaignName, input.holdoutRegions, input.prePeriodDays ?? 30, input.testStart, input.testEnd]
  )
  return rows[0]
}
