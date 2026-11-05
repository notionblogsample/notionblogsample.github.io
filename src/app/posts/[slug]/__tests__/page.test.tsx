import { beforeEach, describe, expect, it, vi } from 'vitest'
import PostPage, { generateStaticParams } from '../page'
import { getPostBySlugMemo, getSiteConfigMemo, listPublishedPostsMemo } from '@/lib/request-memo'

vi.mock('@/lib/request-memo', () => ({
  getPostBySlugMemo: vi.fn(),
  getSiteConfigMemo: vi.fn(),
  listPublishedPostsMemo: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSiteConfigMemo).mockResolvedValue({} as Awaited<ReturnType<typeof getSiteConfigMemo>>)
})

describe('post export failures', () => {
  it('propagates API failures instead of exporting a 404 page', async () => {
    const error = new Error('Notion blocks API returned 429')
    vi.mocked(getPostBySlugMemo).mockRejectedValue(error)
    await expect(PostPage({ params: Promise.resolve({ slug: 'published-post' }) })).rejects.toBe(error)
  })

  it('propagates list failures instead of exporting fallback slugs', async () => {
    const error = new Error('Notion unavailable')
    vi.mocked(listPublishedPostsMemo).mockRejectedValue(error)
    await expect(generateStaticParams()).rejects.toBe(error)
  })

  it('keeps 404 behavior for an actually missing post', async () => {
    vi.mocked(getPostBySlugMemo).mockResolvedValue(null)
    await expect(PostPage({ params: Promise.resolve({ slug: 'missing' }) })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404')
  })
})
