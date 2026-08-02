import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchFacebookAdCosts, fetchAdObjectFallback } from '../facebook'

// Minimal stand-in for the global fetch Response this module actually reads
// (`res.ok`, `res.statusText`, `res.json()`) — real fetch Response objects have
// far more surface than this file ever touches.
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, statusText: ok ? 'OK' : 'Error', json: async () => body } as Response
}

describe('fetchFacebookAdCosts', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('parses an insight row into AdCostRow shape, including spend/frequency parsing and video watch-time sums', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              campaign_id: 'c1',
              campaign_name: 'Campaign 1',
              adset_id: 'as1',
              adset_name: 'Adset 1',
              ad_id: 'ad1',
              ad_name: 'Ad 1',
              spend: '12.50',
              impressions: '1000',
              clicks: '20',
              frequency: '1.4',
              date_start: '2026-07-01',
              video_play_actions: [{ action_type: 'video_play', value: '100' }],
              video_p25_watched_actions: [{ action_type: 'x', value: '50' }],
            },
          ],
          paging: {},
        })
      )
      .mockResolvedValueOnce(jsonResponse({ creative: { image_url: 'https://img.example', thumbnail_url: 'https://thumb.example' } }))

    const rows = await fetchFacebookAdCosts('token', '123456', '2026-07-01', '2026-07-01')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      date: '2026-07-01',
      campaign_id: 'c1',
      ad_id: 'ad1',
      spend: 12.5,
      impressions: 1000,
      clicks: 20,
      frequency: 1.4,
      video_plays: 100,
      video_p25_watched: 50,
      video_p50_watched: null,
      creative_asset_url: 'https://img.example',
      creative_type: 'image',
    })
  })

  it('prefixes a bare numeric ad account id with act_, and does not double-prefix one that already has it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], paging: {} }))

    await fetchFacebookAdCosts('token', '999', '2026-07-01', '2026-07-01')
    expect(fetchMock.mock.calls[0][0]).toContain('/act_999/insights')

    fetchMock.mockClear()
    await fetchFacebookAdCosts('token', 'act_999', '2026-07-01', '2026-07-01')
    expect(fetchMock.mock.calls[0][0]).toContain('/act_999/insights')
    expect(fetchMock.mock.calls[0][0]).not.toContain('act_act_999')
  })

  it('follows pagination via paging.next until it runs out', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ ad_id: 'ad1', date_start: '2026-07-01' }], paging: { next: 'https://graph.facebook.com/next-page' } })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ ad_id: 'ad2', date_start: '2026-07-02' }], paging: {} }))
      .mockResolvedValueOnce(jsonResponse({ creative: null }))
      .mockResolvedValueOnce(jsonResponse({ creative: null }))

    const rows = await fetchFacebookAdCosts('token', '123', '2026-07-01', '2026-07-02')

    expect(rows.map((r) => r.ad_id)).toEqual(['ad1', 'ad2'])
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.facebook.com/next-page')
  })

  it('throws with the Graph API error message when the insights request itself fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } }, false)
    )
    await expect(fetchFacebookAdCosts('bad-token', '123', '2026-07-01', '2026-07-01')).rejects.toThrow('Invalid OAuth access token')
  })

  it("one ad's creative lookup throwing (malformed/non-JSON response) does not crash the whole sync — same failure class that broke Snapchat's sync (ISSUE_LOG 2026-07-28)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { ad_id: 'ad-ok', date_start: '2026-07-01', spend: '1' },
            { ad_id: 'ad-broken', date_start: '2026-07-01', spend: '2' },
          ],
          paging: {},
        })
      )
      .mockResolvedValueOnce(jsonResponse({ creative: { image_url: 'https://img.example' } }))
      .mockResolvedValueOnce({
        ok: true,
        statusText: 'OK',
        json: async () => {
          throw new Error('Unexpected token < in JSON')
        },
      } as unknown as Response)

    const rows = await fetchFacebookAdCosts('token', '123', '2026-07-01', '2026-07-01')

    expect(rows).toHaveLength(2)
    const broken = rows.find((r) => r.ad_id === 'ad-broken')!
    expect(broken.creative_asset_url).toBeNull()
    expect(broken.spend).toBe(2)
  })

  it('dedupes the creative lookup across multiple day-rows for the same ad_id (one call, not one per day)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { ad_id: 'ad1', date_start: '2026-07-01' },
            { ad_id: 'ad1', date_start: '2026-07-02' },
          ],
          paging: {},
        })
      )
      .mockResolvedValueOnce(jsonResponse({ creative: { image_url: 'https://img.example' } }))

    await fetchFacebookAdCosts('token', '123', '2026-07-01', '2026-07-02')
    // 1 insights call + exactly 1 creative call, not 2, despite ad1 appearing on both days
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('fetchAdObjectFallback', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves name/campaign/adset/creative for an ad missing from Insights (too new or paused-and-dropped)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        name: 'Recovered_Ad',
        campaign: { id: 'c1', name: 'Nothing_But_Buckets_Cold_V1' },
        adset: { id: 'as1', name: 'Adset 1' },
        creative: { image_url: 'https://img.example' },
      })
    )

    const result = await fetchAdObjectFallback('token', 'ad123')

    expect(result).toMatchObject({
      ad_name: 'Recovered_Ad',
      campaign_id: 'c1',
      campaign_name: 'Nothing_But_Buckets_Cold_V1',
    })
    expect(result?.creative.assetUrl).toBe('https://img.example')
  })

  it('returns null for a genuinely deleted ad, matching the documented tested-live limit (ISSUE_LOG 2026-07-27)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { message: 'Unsupported get request. Object does not exist', type: 'GraphMethodException', code: 100, error_subcode: 33 } },
        false
      )
    )
    const result = await fetchAdObjectFallback('token', 'deleted-ad-id')
    expect(result).toBeNull()
  })
})
