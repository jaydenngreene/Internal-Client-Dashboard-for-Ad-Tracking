;(function () {
  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      value
    )
  }

  function renderOverlay(data) {
    var existing = document.getElementById('adt-overlay')
    if (existing) existing.remove()

    var el = document.createElement('div')
    el.id = 'adt-overlay'
    el.innerHTML =
      '<div class="adt-overlay-header">True Attribution <span class="adt-overlay-close">&times;</span></div>' +
      '<div class="adt-overlay-row"><span>Cost</span><strong class="adt-cost">' +
      formatCurrency(data.cost) +
      '</strong></div>' +
      '<div class="adt-overlay-row"><span>Revenue</span><strong class="adt-revenue">' +
      formatCurrency(data.revenue) +
      '</strong></div>' +
      '<div class="adt-overlay-row"><span>Profit</span><strong class="' +
      (data.profit >= 0 ? 'adt-revenue' : 'adt-cost') +
      '">' +
      formatCurrency(data.profit) +
      '</strong></div>' +
      '<div class="adt-overlay-row"><span>ROAS</span><strong>' +
      (data.roas === null ? '—' : data.roas.toFixed(2) + 'x') +
      '</strong></div>'

    document.body.appendChild(el)
    el.querySelector('.adt-overlay-close').addEventListener('click', function () {
      el.remove()
    })
  }

  function renderError(message) {
    var existing = document.getElementById('adt-overlay')
    if (existing) existing.remove()
    var el = document.createElement('div')
    el.id = 'adt-overlay'
    el.innerHTML =
      '<div class="adt-overlay-header">True Attribution <span class="adt-overlay-close">&times;</span></div>' +
      '<div class="adt-overlay-error">' +
      message +
      ' — configure the extension via the toolbar icon.</div>'
    document.body.appendChild(el)
    el.querySelector('.adt-overlay-close').addEventListener('click', function () {
      el.remove()
    })
  }

  chrome.storage.local.get(['apiUrl', 'apiSecret', 'clientId'], function (config) {
    if (!config.apiUrl || !config.apiSecret || !config.clientId) {
      renderError('Not configured')
      return
    }

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_OVERVIEW',
        apiUrl: config.apiUrl,
        apiSecret: config.apiSecret,
        clientId: config.clientId,
      },
      function (response) {
        if (!response || !response.ok) {
          renderError((response && response.error) || 'Failed to load')
          return
        }
        renderOverlay(response.data)
      }
    )
  })
})()
