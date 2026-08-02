import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGoogleAdCosts } from '../google'
import * as googleAdsClient from '../../../lib/googleAdsClient'

vi.mock('../../../lib/googleAdsClient', () => ({
  getGoogleAdsCustomer: vi.fn(),
}))

function customerReturning(rows: unknown[]) {
  return { report: vi.fn().mockResolvedValue(rows) }
}

describe('fetchGoogleAdCosts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts cost_micros to dollars and maps campaign/ad group/ad fields', async () => {
    vi.mocked(googleAdsClient.getGoogleAdsCustomer).mockReturnValue(
      customerReturning([
        {
          campaign: { id: 'c1', name: 'Campaign 1' },
          ad_group: { id: 'ag1', name: 'Ad Group 1' },
          ad_group_ad: { ad: { id: 'a1', name: 'Ad 1', final_urls: ['https://example.com'] } },
          metrics: { cost_micros: 12_500_000, clicks: 20, impressions: 1000 },
          segments: { date: '2026-07-01' },
        },
      ]) as never
    )

    const rows = await fetchGoogleAdCosts({ customer_id: '123' }, '2026-07-01', '2026-07-01')

    expect(rows).toEqual([
      expect.objectContaining({
        date: '2026-07-01',
        campaign_id: 'c1',
        campaign_name: 'Campaign 1',
        adset_id: 'ag1',
        adset_name: 'Ad Group 1',
        ad_id: 'a1',
        ad_name: 'Ad 1',
        spend: 12.5,
        impressions: 1000,
        clicks: 20,
        creative_landing_page_url: 'https://example.com',
      }),
    ])
  })

  it('prefers Responsive Search Ad headline/description over legacy Expanded Text Ad fields when both exist', async () => {
    vi.mocked(googleAdsClient.getGoogleAdsCustomer).mockReturnValue(
      customerReturning([
        {
          campaign: { id: 'c1', name: 'C' },
          ad_group: { id: 'ag1', name: 'AG' },
          ad_group_ad: {
            ad: {
              id: 'a1',
              name: null,
              responsive_search_ad: { headlines: [{ text: 'RSA Headline' }], descriptions: [{ text: 'RSA Desc' }] },
              expanded_text_ad: { headline_part1: 'ETA', description: 'ETA Desc' },
            },
          },
          metrics: { cost_micros: 0, clicks: 0, impressions: 0 },
          segments: { date: '2026-07-01' },
        },
      ]) as never
    )

    const [row] = await fetchGoogleAdCosts({ customer_id: '123' }, '2026-07-01', '2026-07-01')
    expect(row.creative_headline).toBe('RSA Headline')
    expect(row.creative_description).toBe('RSA Desc')
  })

  it('falls back to Expanded Text Ad fields when no Responsive Search Ad data exists', async () => {
    vi.mocked(googleAdsClient.getGoogleAdsCustomer).mockReturnValue(
      customerReturning([
        {
          campaign: { id: 'c1', name: 'C' },
          ad_group: { id: 'ag1', name: 'AG' },
          ad_group_ad: {
            ad: {
              id: 'a1',
              name: null,
              expanded_text_ad: { headline_part1: 'Save Big', headline_part2: 'Today', description: 'Shop now', description2: 'Free shipping' },
            },
          },
          metrics: { cost_micros: 0, clicks: 0, impressions: 0 },
          segments: { date: '2026-07-01' },
        },
      ]) as never
    )

    const [row] = await fetchGoogleAdCosts({ customer_id: '123' }, '2026-07-01', '2026-07-01')
    expect(row.creative_headline).toBe('Save Big - Today')
    expect(row.creative_description).toBe('Shop now Free shipping')
    // Search ads have no field distinct from headline/description the way Facebook's
    // "primary text" is — this app never invents one.
    expect(row.creative_primary_text).toBeNull()
  })

  it('passes the client config through to getGoogleAdsCustomer unchanged (MCC vs. per-client refresh-token routing)', async () => {
    vi.mocked(googleAdsClient.getGoogleAdsCustomer).mockReturnValue(customerReturning([]) as never)

    const config = { customer_id: '123', login_customer_id: '456', refresh_token: 'rt-abc' }
    await fetchGoogleAdCosts(config, '2026-07-01', '2026-07-01')
    expect(googleAdsClient.getGoogleAdsCustomer).toHaveBeenCalledWith(config)
  })
})
