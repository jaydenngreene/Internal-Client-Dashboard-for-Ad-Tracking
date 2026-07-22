// Actually pausing an ad via each platform's API — deliberately Facebook-only for
// now, same "implement fully for one platform first, extend later" precedent as
// creative assets (Step 30 review) and ad copy (2026-07-22) before those were
// extended to the other 7. Confirming a pause candidate for any other platform
// surfaces a clear "not supported yet" error rather than guessing at an API shape
// that would just fail at runtime anyway (Google Ads pausing needs an ad_group_id
// this app doesn't currently capture in ad_costs, for example).
export async function pauseAd(
  platform: string,
  config: Record<string, string>,
  adId: string
): Promise<void> {
  if (platform !== 'facebook_ads') {
    throw new Error(`Pausing ads on ${platform} isn't supported yet — pause it manually in that platform's ad manager.`)
  }

  // Note for the go-live checklist: this needs a token with `ads_management`
  // permission on the ad — the `facebook_ads` integration's existing token only
  // needs `ads_read` for cost-sync, so pausing may 403 even when cost sync works
  // fine with the same stored token, depending on what scope was actually granted.
  const res = await fetch(`https://graph.facebook.com/v21.0/${adId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ status: 'PAUSED', access_token: config.access_token }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Facebook pause request failed (${res.status}): ${text}`)
  }
}
