import AdmZip from 'adm-zip'
import { AdCostRow } from './types'
import { BingAdsClientConfig, getBingAccessToken, bingAuthHeaders } from '../../lib/bingAdsClient'

// UNVERIFIED AGAINST A LIVE ACCOUNT — same disclosure as the Facebook/Google syncs had
// before real credentials existed for them. Structure follows Microsoft's documented
// Reporting API v13 (submit -> poll -> download a zipped CSV); there's no maintained
// npm wrapper for Bing/Microsoft Advertising the way there is for Google Ads, so this
// is hand-rolled against the docs rather than a tested client library.

export type { BingAdsClientConfig }

const REPORTING_BASE = 'https://reporting.api.bingads.microsoft.com/Reporting/v13'

function toBingDate(iso: string): { Year: number; Month: number; Day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { Year: year, Month: month, Day: day }
}

async function submitReport(headers: Record<string, string>, accountId: string, since: string, until: string): Promise<string> {
  const body = {
    ReportRequest: {
      Type: 'AdPerformanceReportRequest',
      Format: 'Csv',
      ReportName: 'ADT Ad Performance',
      ReturnOnlyCompleteData: false,
      Aggregation: 'Daily',
      Scope: { AccountIds: [Number(accountId)] },
      Time: { CustomDateRangeStart: toBingDate(since), CustomDateRangeEnd: toBingDate(until) },
      Columns: [
        'TimePeriod',
        'CampaignId',
        'CampaignName',
        'AdGroupId',
        'AdGroupName',
        'AdId',
        'Spend',
        'Impressions',
        'Clicks',
        'AdTitle',
        'AdDescription',
        'DestinationUrl',
      ],
    },
  }
  const res = await fetch(`${REPORTING_BASE}/GenerateReport/Submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Bing Ads report submit failed (${res.status}): ${await res.text()}`)
  const data = (await res.json()) as { ReportRequestId: string }
  return data.ReportRequestId
}

async function pollReport(headers: Record<string, string>, reportRequestId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${REPORTING_BASE}/GenerateReport/Poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ReportRequestId: reportRequestId }),
    })
    if (!res.ok) throw new Error(`Bing Ads report poll failed (${res.status})`)
    const data = (await res.json()) as {
      ReportRequestStatus: { Status: string; ReportDownloadUrl?: string }
    }
    if (data.ReportRequestStatus.Status === 'Success' && data.ReportRequestStatus.ReportDownloadUrl) {
      return data.ReportRequestStatus.ReportDownloadUrl
    }
    if (data.ReportRequestStatus.Status === 'Error') {
      throw new Error('Bing Ads report generation returned an error status')
    }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  throw new Error('Bing Ads report polling timed out')
}

// Bing's CSV reports have a few metadata lines (report name, date range) before the
// real header row — find the header by its known first column rather than assuming
// a fixed line number.
function parseReportCsv(csvText: string): AdCostRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const headerIndex = lines.findIndex((l) => l.startsWith('TimePeriod'))
  if (headerIndex === -1) return []

  const headers = lines[headerIndex].split(',').map((h) => h.replace(/^"|"$/g, ''))
  const col = (name: string) => headers.indexOf(name)

  return lines.slice(headerIndex + 1).map((line) => {
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''))
    return {
      date: cells[col('TimePeriod')],
      campaign_id: cells[col('CampaignId')] || null,
      campaign_name: cells[col('CampaignName')] || null,
      adset_id: cells[col('AdGroupId')] || null,
      adset_name: cells[col('AdGroupName')] || null,
      ad_id: cells[col('AdId')],
      ad_name: null,
      spend: parseFloat(cells[col('Spend')] || '0'),
      impressions: parseInt(cells[col('Impressions')] || '0', 10),
      clicks: parseInt(cells[col('Clicks')] || '0', 10),
      // Microsoft's text/expanded-text-ad formats always carry these two columns —
      // there's no separate "primary text" field distinct from headline/description
      // (same shape as Google Search ads).
      creative_headline: cells[col('AdTitle')] || null,
      creative_primary_text: null,
      creative_description: cells[col('AdDescription')] || null,
      creative_landing_page_url: cells[col('DestinationUrl')] || null,
    }
  })
}

export async function fetchBingAdCosts(config: BingAdsClientConfig, since: string, until: string): Promise<AdCostRow[]> {
  const token = await getBingAccessToken(config.refresh_token)
  const headers = bingAuthHeaders(token, config)
  const reportRequestId = await submitReport(headers, config.account_id, since, until)
  const downloadUrl = await pollReport(headers, reportRequestId)

  const res = await fetch(downloadUrl)
  if (!res.ok) throw new Error(`Bing Ads report download failed (${res.status})`)
  const buffer = Buffer.from(await res.arrayBuffer())

  const zip = new AdmZip(buffer)
  const entry = zip.getEntries()[0]
  if (!entry) return []

  return parseReportCsv(entry.getData().toString('utf8'))
}
