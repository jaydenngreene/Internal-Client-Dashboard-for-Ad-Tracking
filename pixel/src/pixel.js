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

  function trackCartEvent(eventType, product, value) {
    product = product || {}
    send('/track/event', {
      anonymous_id: getVisitorId(),
      event_type: eventType,
      url: window.location.href,
      product_id: product.id != null ? String(product.id) : null,
      product_name: product.name || null,
      value: value != null ? value : null,
    })
  }

  ADT.trackViewContent = function (product, value) {
    trackCartEvent('view_item', product, value)
  }

  ADT.trackAddToCart = function (product, value) {
    trackCartEvent('add_to_cart', product, value)
  }

  ADT.trackInitiateCheckout = function (value) {
    trackCartEvent('begin_checkout', null, value)
  }

  // Dynamic Number Insertion — swaps the phone number(s) matching `selector` with a
  // tracking number assigned to this visitor, so an inbound call can be traced back
  // to the campaign that generated it. Needs a response back (unlike the other
  // tracking calls), so this can't use sendBeacon — a plain XHR instead.
  ADT.enableDNI = function (selector) {
    var xhr = new XMLHttpRequest()
    xhr.open('POST', API_URL + '/track/dni', true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onload = function () {
      if (xhr.status !== 200) return
      var data
      try {
        data = JSON.parse(xhr.responseText)
      } catch (e) {
        return
      }
      if (!data || !data.phone_number) return
      var els = document.querySelectorAll(selector)
      for (var i = 0; i < els.length; i++) {
        els[i].textContent = data.phone_number
        if (els[i].tagName === 'A') {
          els[i].setAttribute('href', 'tel:' + data.phone_number)
        }
      }
    }
    xhr.send(JSON.stringify({ pixel_key: PIXEL_KEY, anonymous_id: getVisitorId() }))
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
