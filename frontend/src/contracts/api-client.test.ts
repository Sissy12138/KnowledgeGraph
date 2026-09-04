import { describe, expect, it, vi } from 'vitest'
import { requestJson } from './api-client'
import type { PageResult } from './v05.types'

describe('requestJson', () => {
  it('preserves the complete v05 error payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'INVALID_REQUEST',
        message: 'bad page',
        retryable: false,
        details: { page: 0 },
        requestId: 'req-1',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } }))

    await expect(requestJson('/api/v1/papers', undefined, fetcher)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
      retryable: false,
      requestId: 'req-1',
      details: { page: 0 },
    })
  })

  it('returns the v05 page response without a derived totalPages field', async () => {
    const page: PageResult<{ id: string }> = {
      items: [{ id: 'paper-1' }],
      page: 1,
      pageSize: 20,
      total: 1,
    }
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }))

    await expect(requestJson<PageResult<{ id: string }>>('/api/v1/papers', undefined, fetcher))
      .resolves.toEqual(page)
  })
})
