export interface AdCostRow {
  date: string // YYYY-MM-DD
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  ad_id: string
  ad_name: string | null
  spend: number
  impressions: number
  clicks: number
}
