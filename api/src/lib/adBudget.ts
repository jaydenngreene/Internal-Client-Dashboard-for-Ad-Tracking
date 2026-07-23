import { getClientCurrency, convertToBaseCurrency } from './currency'

// Actually shifting budget between two campaigns — Facebook-only for now, same
// "implement fully for one platform first" precedent as adPause.ts (Step 35),
// creative assets, and ad copy before those extended to the other 7. The
// suggested shift amount is computed in the client's BASE currency (Step 48);
// Facebook's own daily_budget field is in the ad account's own currency and in
// minor units (cents), so this converts base -> account currency before
// computing new budgets.
interface FacebookCampaignBudget {
  id: string
  daily_budget?: string
}

async function getFacebookDailyBudget(accessToken: string, campaignId: string): Promise<number> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${campaignId}?fields=daily_budget&access_token=${encodeURIComponent(accessToken)}`
  )
  if (!res.ok) throw new Error(`Facebook campaign budget lookup failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as FacebookCampaignBudget
  if (!body.daily_budget) throw new Error(`Campaign ${campaignId} has no daily_budget set (may use a lifetime/ad-set budget instead)`)
  return parseInt(body.daily_budget, 10) // cents, in the ad account's own currency
}

async function setFacebookDailyBudget(accessToken: string, campaignId: string, newBudgetCents: number): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${campaignId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ daily_budget: String(newBudgetCents), access_token: accessToken }),
  })
  if (!res.ok) throw new Error(`Facebook budget update failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}

export async function executeReallocation(
  clientId: string,
  platform: string,
  config: Record<string, string>,
  fromCampaignId: string,
  toCampaignId: string,
  shiftAmountBaseCurrency: number
): Promise<void> {
  if (platform !== 'facebook_ads') {
    throw new Error(`Budget reallocation on ${platform} isn't supported yet. Adjust budgets manually in that platform's ad manager.`)
  }

  const baseCurrency = await getClientCurrency(clientId)
  const accountCurrency = config.currency ?? baseCurrency
  // Converts the base-currency shift amount back into the ad account's own
  // currency — the reverse direction of Step 48's ad-cost ingestion conversion.
  const shiftAmountAccountCurrency = await convertToBaseCurrency(shiftAmountBaseCurrency, baseCurrency, accountCurrency)
  const shiftCents = Math.round(shiftAmountAccountCurrency * 100)

  const [fromBudget, toBudget] = await Promise.all([
    getFacebookDailyBudget(config.access_token, fromCampaignId),
    getFacebookDailyBudget(config.access_token, toCampaignId),
  ])

  const newFromBudget = Math.max(100, fromBudget - shiftCents) // never drop below $1/day
  const newToBudget = toBudget + shiftCents

  await setFacebookDailyBudget(config.access_token, fromCampaignId, newFromBudget)
  await setFacebookDailyBudget(config.access_token, toCampaignId, newToBudget)
}
