import { describe, expect, it } from 'vitest'
import {
  createMockSuggestionService,
  SuggestionApiError,
} from './suggestion.service'

describe('suggestion service', () => {
  it('returns pending suggestions with complete evidence', async () => {
    const service = createMockSuggestionService()

    const result = await service.listSuggestions('pending')

    expect(result.total).toBe(4)
    expect(result.items).toHaveLength(4)
    expect(result.items.every((item) => item.status === 'pending')).toBe(true)
    expect(result.items[0].evidence[0]).toMatchObject({
      id: expect.any(String),
      paperId: 'paper-001',
      section: 'Introduction',
      text: expect.any(String),
    })
  })

  it('accepts a pending suggestion and returns the complete updated object', async () => {
    const service = createMockSuggestionService()

    const updated = await service.acceptSuggestion('suggestion-001')

    expect(updated).toMatchObject({
      id: 'suggestion-001',
      status: 'accepted',
      reviewedAt: expect.any(String),
      reviewComment: null,
    })
    expect(updated.evidence).not.toHaveLength(0)

    const accepted = await service.listSuggestions('accepted')
    expect(accepted.items.map((item) => item.id)).toContain('suggestion-001')
  })

  it('persists up to three explicit entity-resolution selections when accepting', async () => {
    const service = createMockSuggestionService()

    const updated = await service.acceptSuggestion('suggestion-001', {
      selections: [
        {
          candidateId: 'concept-existing-flipped-classroom',
          operation: 'linkExisting',
          targetEntityId: 'concept-flipped-classroom',
          name: '翻转课堂',
          confidence: 0.86,
        },
        {
          candidateId: 'concept-new-inverted-learning',
          operation: 'createNew',
          targetEntityId: null,
          name: '反转学习',
          confidence: 0.72,
        },
      ],
    })

    expect(updated.resolvedSelections).toEqual([
      expect.objectContaining({
        operation: 'linkExisting',
        targetEntityId: 'concept-flipped-classroom',
      }),
      expect.objectContaining({ operation: 'createNew', name: '反转学习' }),
    ])
  })

  it('rejects an entity-resolution acceptance with no selection', async () => {
    const service = createMockSuggestionService()

    await expect(
      service.acceptSuggestion('suggestion-001', { selections: [] }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_RESOLUTION_SELECTIONS',
    })
  })

  it('rejects a pending suggestion and keeps the review comment', async () => {
    const service = createMockSuggestionService()

    const updated = await service.rejectSuggestion(
      'suggestion-002',
      '方法描述还不够明确',
    )

    expect(updated.status).toBe('rejected')
    expect(updated.reviewComment).toBe('方法描述还不够明确')
    expect(updated.reviewedAt).not.toBeNull()
  })

  it('returns the agreed 409 conflict when a suggestion is reviewed twice', async () => {
    const service = createMockSuggestionService()
    await service.acceptSuggestion('suggestion-001')

    await expect(
      service.rejectSuggestion('suggestion-001', '再次审核'),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUGGESTION_ALREADY_REVIEWED',
    })

    try {
      await service.rejectSuggestion('suggestion-001')
    } catch (error) {
      expect(error).toBeInstanceOf(SuggestionApiError)
    }
  })

  it('returns all suggestions across pending, accepted and rejected states', async () => {
    const service = createMockSuggestionService()

    const all = await service.listAllSuggestions()

    expect(new Set(all.map((item) => item.status))).toEqual(
      new Set(['pending', 'accepted', 'rejected']),
    )
  })

  it('keeps successful batch results while reporting conflicts and missing items', async () => {
    const service = createMockSuggestionService()

    const result = await service.reviewSuggestions({
      ids: ['suggestion-001', 'suggestion-accepted-001', 'suggestion-missing'],
      status: 'accepted',
    })

    expect(result.updated.map((item) => item.id)).toEqual(['suggestion-001'])
    expect(result.failures.map((failure) => failure.id)).toEqual([
      'suggestion-accepted-001',
      'suggestion-missing',
    ])
    expect(result.failures.map((failure) => failure.error.status)).toEqual([
      409,
      404,
    ])
  })
})
