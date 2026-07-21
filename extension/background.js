// Service workers aren't bound by the host page's CSP the way a content script's own
// fetch() would be — Facebook/Google's ad manager pages have strict CSPs that would
// block a content script from fetching an arbitrary API origin directly, so all
// network calls are relayed through here instead.

async function fetchOverview(apiUrl, apiSecret, clientId) {
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/api/v1/clients/${clientId}/reports/overview`, {
    headers: { Authorization: `Bearer ${apiSecret}` },
  })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json()
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_OVERVIEW') {
    fetchOverview(message.apiUrl, message.apiSecret, message.clientId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }))
    return true // keep the message channel open for the async response
  }
})
