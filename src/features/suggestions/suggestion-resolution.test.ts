import { describe, expect, it } from 'vitest'
import {
  getDefaultCandidateIds,
  resolveNewCandidateName,
  toggleCandidateSelection,
} from './suggestion-resolution'

const candidates = [
  {
    id: 'candidate-existing-1',
    kind: 'existing' as const,
    entityType: 'concept' as const,
    targetEntityId: 'concept-1',
    name: '翻转课堂',
    originalName: '翻转课堂',
    confidence: 0.86,
  },
  {
    id: 'candidate-new-1',
    kind: 'new' as const,
    entityType: 'concept' as const,
    targetEntityId: null,
    name: '反转学习',
    originalName: '反转学习',
    confidence: 0.72,
  },
]

describe('suggestion resolution rules', () => {
  it('selects only the highest candidate when it reaches the default threshold', () => {
    expect(getDefaultCandidateIds(candidates)).toEqual(['candidate-existing-1'])
    expect(
      getDefaultCandidateIds(
        candidates.map((candidate) => ({ ...candidate, confidence: 0.69 })),
      ),
    ).toEqual([])
  })

  it('allows deselection but refuses a fourth selected candidate', () => {
    expect(toggleCandidateSelection(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c'])
    expect(toggleCandidateSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })

  it('redirects a renamed new candidate to an existing node with the same normalized name', () => {
    expect(
      resolveNewCandidateName('  翻转课堂 ', candidates),
    ).toEqual({
      normalizedName: '翻转课堂',
      matchingExistingCandidateId: 'candidate-existing-1',
    })
  })
})
