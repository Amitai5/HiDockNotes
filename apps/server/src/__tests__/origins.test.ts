import { describe, expect, it } from 'vitest'
import { allowedOrigins } from '../origins'

describe('configured server origins', () => {
  it('allows exact public and local addresses without adding aliases implicitly', () => {
    const origins = allowedOrigins('https://notes.example.com', ['http://truenas.local:10708', 'https://notes.example.com'])
    expect([...origins]).toEqual(['https://notes.example.com', 'http://truenas.local:10708'])
    expect(origins.has('http://truenas.local:10709')).toBe(false)
    expect(origins.has('http://192.168.1.50:10708')).toBe(false)
  })
  it.each(['null', '*', 'https://*.example.com', 'ftp://truenas.local', 'file:///data', 'https://user:pass@notes.example.com', 'https://notes.example.com/', 'http://truenas.local:10708/path', 'http://truenas.local:10708?query=1', 'http://truenas.local:10708#fragment'])('rejects an invalid or ambiguous configured origin: %s', value => {
    expect(() => allowedOrigins('https://notes.example.com', [value])).toThrow('APP_ALLOWED_ORIGINS')
    expect(() => allowedOrigins(value)).toThrow('APP_ORIGIN')
  })
})
