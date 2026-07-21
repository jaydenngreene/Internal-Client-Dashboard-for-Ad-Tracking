import { GoogleAdsApi, Customer } from 'google-ads-api'

export interface GoogleAdsClientConfig {
  customer_id: string
  // Optional per-client overrides — defaults to the shared agency MCC credentials in .env.
  login_customer_id?: string
  refresh_token?: string
}

export function getGoogleAdsApiClient(): GoogleAdsApi {
  const client_id = process.env.GOOGLE_ADS_CLIENT_ID
  const client_secret = process.env.GOOGLE_ADS_CLIENT_SECRET
  const developer_token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  if (!client_id || !client_secret || !developer_token) {
    throw new Error('GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN must be set')
  }
  return new GoogleAdsApi({ client_id, client_secret, developer_token })
}

export function getGoogleAdsCustomer(config: GoogleAdsClientConfig): Customer {
  const apiClient = getGoogleAdsApiClient()
  const refreshToken = config.refresh_token ?? process.env.GOOGLE_ADS_REFRESH_TOKEN
  const loginCustomerId = config.login_customer_id ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  if (!refreshToken) throw new Error('No Google Ads refresh token configured (client or GOOGLE_ADS_REFRESH_TOKEN)')

  return apiClient.Customer({
    customer_id: config.customer_id,
    login_customer_id: loginCustomerId,
    refresh_token: refreshToken,
  })
}
