// Shared OAuth + auth-header helpers for Bing/Microsoft Advertising, extracted out
// of jobs/adCosts/bing.ts (Step 11) so this second real usage — offline conversion
// import (Step 18) — doesn't duplicate the token-refresh flow. Mirrors the role
// googleAdsClient.ts already plays for Google Ads cost-sync + Enhanced Conversions.
export interface BingAdsClientConfig {
  customer_id: string
  account_id: string
  refresh_token: string
}

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

export async function getBingAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.BING_ADS_CLIENT_ID
  const clientSecret = process.env.BING_ADS_CLIENT_SECRET
  if (!clientId) throw new Error('BING_ADS_CLIENT_ID must be set')

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    scope: 'https://ads.microsoft.com/msads.manage offline_access',
  })
  if (clientSecret) params.set('client_secret', clientSecret)

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!res.ok) throw new Error(`Bing Ads OAuth token request failed (${res.status})`)
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

export function bingAuthHeaders(token: string, config: BingAdsClientConfig): Record<string, string> {
  const developerToken = process.env.BING_ADS_DEVELOPER_TOKEN
  if (!developerToken) throw new Error('BING_ADS_DEVELOPER_TOKEN must be set')
  return {
    Authorization: `Bearer ${token}`,
    DeveloperToken: developerToken,
    CustomerAccountId: config.account_id,
    CustomerId: config.customer_id,
    'Content-Type': 'application/json',
  }
}
