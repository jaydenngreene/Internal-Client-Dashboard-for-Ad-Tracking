const fields = ['apiUrl', 'apiSecret', 'clientId']

chrome.storage.local.get(fields, (stored) => {
  fields.forEach((f) => {
    if (stored[f]) document.getElementById(f).value = stored[f]
  })
})

document.getElementById('save').addEventListener('click', () => {
  const values = Object.fromEntries(fields.map((f) => [f, document.getElementById(f).value.trim()]))
  chrome.storage.local.set(values, () => {
    document.getElementById('status').textContent = 'Saved.'
  })
})
