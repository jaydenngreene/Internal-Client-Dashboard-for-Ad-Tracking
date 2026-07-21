;(function (window, document) {
  'use strict'

  var API_URL = '__API_URL__'      // replaced at build/deploy time
  var PIXEL_KEY = '__PIXEL_KEY__'  // replaced per client

  var COOKIE_NAME = '_adt_vid'
  var COOKIE_DAYS = 180

  // ── Visitor ID ──────────────────────────────────────────────────────────────

  function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = name + '=' + value + '; expires=' + expires + '; path=/; SameSite=Lax'
  }

  function getCookie(name) {
    return document.cookie.split('; ').reduce(function (acc, pair) {
      var parts = pair.split('=')
      return parts[0] === name ? parts[1] : acc
    }, null)
  }

  function getVisitorId() {
    var id = getCookie(COOKIE_NAME)
    if (!id) {
      id = generateId()
      setCookie(COOKIE_NAME, id, COOKIE_DAYS)
    }
    return id
  }

  // ── URL Params ──────────────────────────────────────────────────────────────

  function getParams() {
    var params = new URLSearchParams(window.location.search)
    return {
      fbclid: params.get('fbclid'),
      gclid: params.get('gclid'),
      ttclid: params.get('ttclid'),
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
    }
  }

  // Store ad params in sessionStorage so they persist across page navigations
  function storeAdParams(params) {
    var hasAdData = params.fbclid || params.gclid || params.utm_source
    if (hasAdData) {
      sessionStorage.setItem('_adt_params', JSON.stringify(params))
    }
  }

  function getStoredAdParams() {
    try {
      return JSON.parse(sessionStorage.getItem('_adt_params') || 'null')
    } catch (e) {
      return null
    }
  }

  // ── Transport ───────────────────────────────────────────────────────────────

  function send(endpoint, data) {
    var payload = JSON.stringify(Object.assign({ pixel_key: PIXEL_KEY }, data))

    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' })
      navigator.sendBeacon(API_URL + endpoint, blob)
    } else {
      var xhr = new XMLHttpRequest()
      xhr.open('POST', API_URL + endpoint, true)
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.send(payload)
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  var ADT = window.ADT || {}

  ADT.identify = function (email, options) {
    if (!email) return
    options = options || {}
    send('/track/identify', {
      anonymous_id: getVisitorId(),
      email: email,
      lead_type: options.lead_type || 'optin',
      page: window.location.href,
      metadata: options.metadata || null,
    })
  }

  ADT.trackConversion = function (email, revenue, options) {
    if (!email || !revenue) return
    options = options || {}
    send('/track/conversion', {
      anonymous_id: getVisitorId(),
      email: email,
      revenue: revenue,
      product: options.product || null,
      order_id: options.order_id || null,
      processor: options.processor || 'direct',
    })
  }

  window.ADT = ADT

  // ── Auto pageview ───────────────────────────────────────────────────────────

  function trackPageview() {
    var urlParams = getParams()
    storeAdParams(urlParams)
    var adParams = getStoredAdParams() || urlParams

    send('/track/pageview', Object.assign({
      anonymous_id: getVisitorId(),
      url: window.location.href,
      referrer: document.referrer || null,
      landing_page: window.location.href,
    }, adParams))
  }

  // Fire on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageview)
  } else {
    trackPageview()
  }

}(window, document))
