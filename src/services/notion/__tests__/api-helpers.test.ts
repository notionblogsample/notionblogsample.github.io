import { afterEach, describe, expect, it, vi } from 'vitest'
import { notionFetch } from '../api-helpers'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notionFetch', () => {
  it('waits for Retry-After before retrying the individual request', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '40' } }))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const request = notionFetch('https://api.notion.com/v1/blocks/test/children', { apiKey: 'test' })
    await vi.advanceTimersByTimeAsync(39_999)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await request).status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returns non-rate-limit errors without retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    expect((await notionFetch('https://api.notion.com/v1/pages/test', { apiKey: 'test' })).status).toBe(403)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('stops retrying when the rate limit persists', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 429 })))
    vi.stubGlobal('fetch', fetch)
    const request = notionFetch('https://api.notion.com/v1/pages/test', { apiKey: 'test' })
    await vi.runAllTimersAsync()
    expect((await request).status).toBe(429)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
