import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Extraction as ExtractionDto, Suggestion as SuggestionDto, SuggestionPage as SuggestionPageDto } from '../../contracts/v05.types'
import { ApiClientError } from '../../contracts/api-client'
import { createMockSuggestionService, createSuggestionService, loadLatestExtraction } from './suggestion.service'
import { extractionDtoMocks, suggestionPageDtoMock } from './suggestion.mock'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('suggestion service v05 transport', () => {
  it('loads only the public latest extraction endpoint', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const extraction = extractionDtoMocks['paper-001']
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(extraction), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetcher)

    await expect(loadLatestExtraction('paper/1')).resolves.toEqual(extraction)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/papers/paper%2F1/extractions/latest', undefined)
  })

  it('deduplicates page paper IDs and joins candidates through the shared adapter', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const page: SuggestionPageDto = {
      ...suggestionPageDtoMock,
      items: suggestionPageDtoMock.items.filter((item) => item.paperId === 'paper-001').slice(0, 2),
      papers: suggestionPageDtoMock.papers.filter((paper) => paper.id === 'paper-001'),
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(extractionDtoMocks['paper-001']), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    const result = await createSuggestionService().listSuggestions('pending')

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/suggestions?page=1&pageSize=20&status=pending', undefined)
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/papers/paper-001/extractions/latest', undefined)
    expect(result.items[0].candidates).not.toHaveLength(0)
  })

  it('posts v05 accept and reject bodies to individual endpoints', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const pendingDto = suggestionPageDtoMock.items[0]
    const acceptedDto: SuggestionDto = {
      ...pendingDto,
      status: 'accepted',
      executionResult: { type: 'resolveMatch', resolvedTargets: [{ candidateId: 'concept-new-inverted-learning', nodeId: 'concept-new', label: '修订名称', created: true, relationId: 'relation-1' }] },
      reviewedAt: '2026-08-29T10:30:00Z', updatedAt: '2026-08-29T10:30:00Z',
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(acceptedDto), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...suggestionPageDtoMock.items[2], status: 'rejected', reviewedAt: '2026-08-29T10:32:00Z', reviewComment: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const service = createSuggestionService()
    service.prime(suggestionPageDtoMock, extractionDtoMocks)

    const accepted = await service.acceptSuggestion(pendingDto.id, {
      selectedIds: ['concept-new-inverted-learning'],
      labelOverrides: { 'concept-new-inverted-learning': '  修订名称  ' },
      comment: 'ok',
    })
    await service.rejectSuggestion(suggestionPageDtoMock.items[2].id, null)

    expect(accepted.executionResult).toEqual(acceptedDto.executionResult)
    expect(fetcher).toHaveBeenNthCalledWith(1, `/api/v1/suggestions/${pendingDto.id}/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'ok', resolution: { selectedTargets: [{ candidateId: 'concept-new-inverted-learning', labelOverride: '修订名称' }] } }),
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, `/api/v1/suggestions/${suggestionPageDtoMock.items[2].id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: null }),
    })
  })
})

describe('mock suggestion service', () => {
  it('returns the complete page DTO through the same page adapter', async () => {
    const page = await createMockSuggestionService().listSuggestions('pending')
    expect(page.papers).not.toHaveLength(0)
    expect(page.evidence).not.toHaveLength(0)
    expect(page.statusCounts).toEqual({ pending: 4, accepted: 1, rejected: 1, superseded: 1 })
    expect(page.items.every((item) => item.status === 'pending')).toBe(true)
  })

  it('skips each resolve item with no backend default while settling all other reviews', async () => {
    const withoutDefault: SuggestionPageDto = structuredClone(suggestionPageDtoMock)
    const target = withoutDefault.items.find((item) => item.id === 'suggestion-006')
    if (!target || target.proposedChange.type !== 'resolveMethodMatch') throw new Error('fixture missing')
    target.proposedChange.defaultCandidateId = null
    const service = createMockSuggestionService(withoutDefault, extractionDtoMocks)

    const result = await service.reviewSuggestions({
      ids: ['suggestion-005', 'suggestion-006', 'suggestion-missing'], status: 'accepted', comment: null,
    })

    expect(result.updated.map((item) => item.id)).toEqual(['suggestion-005'])
    expect(result.skipped).toEqual(['suggestion-006'])
    expect(result.failures.map((failure) => failure.id)).toEqual(['suggestion-missing'])
    expect(result.failures[0].error).toBeInstanceOf(ApiClientError)
  })

  it('does not review a pending resolve suggestion bound to a stale extraction', async () => {
    const newer: Record<string, ExtractionDto> = {
      ...extractionDtoMocks,
      'paper-001': { ...extractionDtoMocks['paper-001'], id: 'extraction-newer' },
    }
    const service = createMockSuggestionService(suggestionPageDtoMock, newer)
    const page = await service.listSuggestions('pending')

    expect(page.items[0].canReview).toBe(false)
    await expect(service.acceptSuggestion(page.items[0].id)).rejects.toMatchObject({ status: 409, code: 'SUGGESTION_SUPERSEDED' })
  })
})
