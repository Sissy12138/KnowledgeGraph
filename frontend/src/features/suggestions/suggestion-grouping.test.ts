import { describe, expect, it } from 'vitest'
import { extractionDtoMocks, suggestionPageDtoMock } from './suggestion.mock'
import { toSuggestionPageView } from './suggestion.adapter'
import { groupSuggestionsByPaper } from './suggestion-grouping'

describe('groupSuggestionsByPaper', () => {
  it('groups by v05 operation in stable display order', () => {
    const page = toSuggestionPageView(suggestionPageDtoMock, extractionDtoMocks)
    const groups = groupSuggestionsByPaper(page.items.slice(0, 2), page.papers)

    expect(groups).toHaveLength(1)
    expect(groups[0].categories.map((category) => category.operation)).toEqual([
      'resolveConceptMatch',
      'resolveMethodMatch',
      'addFinding',
      'addRelation',
    ])
    expect(groups[0].categories[0].items).toHaveLength(1)
    expect(groups[0].categories[1].items).toHaveLength(1)
  })

  it('keeps first-seen paper order and a stable unknown-paper fallback', () => {
    const page = toSuggestionPageView(suggestionPageDtoMock, extractionDtoMocks)
    const unknown = { ...page.items[0], id: 'unknown', paperId: 'paper-unknown' }
    const groups = groupSuggestionsByPaper([unknown, page.items[2], page.items[1]], page.papers)

    expect(groups.map((group) => group.paperId)).toEqual(['paper-unknown', 'paper-003', 'paper-001'])
    expect(groups[0].paperTitle).toBe('未知论文（paper-unknown）')
  })
})
