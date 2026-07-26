;(function (window, document) {
  'use strict'

  // Read from window.ADT_CONFIG (set by the small inline snippet on the host
  // page — see theme-snippet.liquid / the Settings pixel install block) rather
  // than a build-time placeholder — this file is built once and served as-is
  // from the API at /pixel.js, configured per page instead of rebuilt per client.
  var config = window.ADT_CONFIG || {}
  var API_URL = config.apiUrl || ''
  var PIXEL_KEY = config.pixelKey || ''

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

  // ── Device fingerprint (Step 13) ─────────────────────────────────────────────
  // A composite signal that survives cookie clearing/incognito/private windows,
  // unlike the cookie-based visitor id above — Hyros calls this "Print Tracking."
  // Collection only; server-side matching on this hash is Step 14, not here.
  // Computed once per browser session (cached in sessionStorage) since none of
  // these signals change mid-session and canvas/audio rendering isn't free.

  function canvasSignal() {
    try {
      var canvas = document.createElement('canvas')
      var ctx = canvas.getContext('2d')
      if (!ctx) return ''
      canvas.width = 220
      canvas.height = 30
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillStyle = '#f60'
      ctx.fillRect(0, 0, 100, 20)
      ctx.fillStyle = '#069'
      ctx.fillText('adt-fingerprint 🔒 v1', 2, 2)
      return canvas.toDataURL()
    } catch (e) {
      return ''
    }
  }

  function webglSignal() {
    try {
      var canvas = document.createElement('canvas')
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
      if (!gl) return ''
      var info = gl.getExtension('WEBGL_debug_renderer_info')
      if (!info) return ''
      var vendor = gl.getParameter(info.UNMASKED_VENDOR_WEBGL)
      var renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
      return vendor + '~' + renderer
    } catch (e) {
      return ''
    }
  }

  // OfflineAudioContext rendering is async — resolves with a summed-sample signal
  // derived from a fixed oscillator, which varies by audio stack/hardware.
  function audioSignal() {
    return new Promise(function (resolve) {
      try {
        var AudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext
        if (!AudioCtx) return resolve('')
        var ctx = new AudioCtx(1, 5000, 44100)
        var oscillator = ctx.createOscillator()
        oscillator.type = 'triangle'
        oscillator.frequency.value = 10000
        var compressor = ctx.createDynamicsCompressor()
        oscillator.connect(compressor)
        compressor.connect(ctx.destination)
        oscillator.start(0)
        ctx.oncomplete = function (event) {
          var buffer = event.renderedBuffer.getChannelData(0)
          var sum = 0
          for (var i = 0; i < buffer.length; i += 100) sum += Math.abs(buffer[i])
          resolve(String(sum))
        }
        ctx.startRendering()
        // Some browsers can hang here (autoplay policy, etc) — never block the
        // pixel's core job on this.
        setTimeout(function () { resolve('') }, 800)
      } catch (e) {
        resolve('')
      }
    })
  }

  function fnv1a(str) {
    var hash = 0x811c9dc5
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    return hash.toString(16)
  }

  function sha256Hex(str) {
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
      var data = new TextEncoder().encode(str)
      return window.crypto.subtle.digest('SHA-256', data).then(function (buf) {
        var bytes = new Uint8Array(buf)
        var hex = ''
        for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
        return hex
      }).catch(function () {
        return fnv1a(str)
      })
    }
    // Non-HTTPS embeds (crypto.subtle requires a secure context) fall back to a
    // fast synchronous hash — lower collision resistance, still usable as a match key.
    return Promise.resolve(fnv1a(str))
  }

  var fingerprintPromise = null

  function getFingerprint() {
    if (fingerprintPromise) return fingerprintPromise

    var cached = null
    try {
      cached = JSON.parse(sessionStorage.getItem('_adt_fp') || 'null')
    } catch (e) {}
    if (cached && cached.hash) {
      fingerprintPromise = Promise.resolve(cached)
      return fingerprintPromise
    }

    fingerprintPromise = audioSignal().then(function (audio) {
      var components = {
        canvas: canvasSignal(),
        webgl: webglSignal(),
        audio: audio,
        ua: navigator.userAgent,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        lang: navigator.language || '',
        screen: screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        cores: navigator.hardwareConcurrency || 0,
      }
      var raw = Object.keys(components).sort().map(function (k) { return k + ':' + components[k] }).join('|')
      return sha256Hex(raw).then(function (hash) {
        var result = { hash: hash, components: components }
        try {
          sessionStorage.setItem('_adt_fp', JSON.stringify(result))
        } catch (e) {}
        return result
      })
    })

    return fingerprintPromise
  }

  // ── URL Params ──────────────────────────────────────────────────────────────

  function extractAdParams(search) {
    var params = new URLSearchParams(search)
    return {
      fbclid: params.get('fbclid'),
      gclid: params.get('gclid'),
      ttclid: params.get('ttclid'),
      msclkid: params.get('msclkid'),
      utm_source: params.get('utm_source'),
      utm_medium: params.get('utm_medium'),
      utm_campaign: params.get('utm_campaign'),
      utm_content: params.get('utm_content'),
      utm_term: params.get('utm_term'),
    }
  }

  function hasAnyAdSignal(p) {
    return !!(p.fbclid || p.gclid || p.ttclid || p.msclkid || p.utm_source)
  }

  function getReferrerSearch() {
    try {
      return document.referrer ? new URL(document.referrer).search : ''
    } catch (e) {
      return ''
    }
  }

  // A "Buy Now"/dynamic-checkout ad click can land a visitor directly on
  // Shopify's checkout (ad params in THAT url) before this pixel ever runs on
  // a page - by the time they reach one, the current url is clean but
  // document.referrer still carries the checkout url's full query string.
  // Falls back to parsing ad params out of the referrer rather than losing
  // them entirely - confirmed live 2026-07-26 (real fbclid/utm_campaign/ad_id
  // data sitting in a session's referrer while the session itself had none,
  // silently miscounted as direct/organic traffic).
  function getParams() {
    var fromUrl = extractAdParams(window.location.search)
    if (hasAnyAdSignal(fromUrl)) return fromUrl
    var fromReferrer = extractAdParams(getReferrerSearch())
    if (hasAnyAdSignal(fromReferrer)) return fromReferrer
    return fromUrl
  }

  // Store ad params in sessionStorage so they persist across page navigations
  function storeAdParams(params) {
    var hasAdData = params.fbclid || params.gclid || params.msclkid || params.utm_source
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

  ADT.applyTag = function (tagName) {
    if (!tagName) return
    send('/track/tag', {
      anonymous_id: getVisitorId(),
      tag_name: tagName,
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

  // Async now (waits on the fingerprint) — still fires as early as DOMContentLoaded,
  // just no longer synchronous. The fingerprint promise is cached across the whole
  // session (see getFingerprint), so only the very first pageview pays the real
  // collection cost; later navigations resolve instantly from sessionStorage.
  function trackPageview() {
    var urlParams = getParams()
    storeAdParams(urlParams)
    var adParams = getStoredAdParams() || urlParams

    getFingerprint().then(function (fp) {
      send('/track/pageview', Object.assign({
        anonymous_id: getVisitorId(),
        url: window.location.href,
        referrer: document.referrer || null,
        landing_page: window.location.href,
        fingerprint_hash: fp.hash,
        fingerprint_components: fp.components,
      }, adParams))
    })
  }

  // Fire on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageview)
  } else {
    trackPageview()
  }

}(window, document))
