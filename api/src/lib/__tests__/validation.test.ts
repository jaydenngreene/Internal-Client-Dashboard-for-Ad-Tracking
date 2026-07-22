import { describe, it, expect } from 'vitest'
import { isValidEmail, isValidUrl } from '../validation'

describe('isValidEmail', () => {
  it('accepts a plain, well-formed email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
  })

  it('accepts an email with subdomains and a plus tag', () => {
    expect(isValidEmail('user+tag@mail.example.co.uk')).toBe(true)
  })

  it('rejects a string with no @', () => {
    expect(isValidEmail('notanemail')).toBe(false)
  })

  it('rejects a string with no domain', () => {
    expect(isValidEmail('user@')).toBe(false)
  })

  it('rejects a string with no TLD', () => {
    expect(isValidEmail('user@localhost')).toBe(false)
  })

  it('rejects a string containing whitespace', () => {
    expect(isValidEmail('user name@example.com')).toBe(false)
  })
})

describe('isValidUrl', () => {
  it('accepts a plain https URL', () => {
    expect(isValidUrl('https://example.com/webhook')).toBe(true)
  })

  it('accepts a plain http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  it('rejects a bare string with no protocol', () => {
    expect(isValidUrl('x')).toBe(false)
  })

  it('rejects a non-http(s) protocol', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidUrl('')).toBe(false)
  })
})
