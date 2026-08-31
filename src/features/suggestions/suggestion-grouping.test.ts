import { describe, expect, it } from 'vitest'
import { suggestionMocks } from './suggestion.mock'
import { groupSuggestionsByPaper } from './suggestion-grouping'

describe('groupSuggestionsByPaper', () => {
  it('groups suggestions by paper and always provides four ordered categories', () => {
    const groups = groupSuggestionsByPaper(suggestionMocks.slice(0, 2), [
      { id: 'paper-001', title: '论文一' },
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].paperTitle).toBe('论文一')
    expect(groups[0].total).toBe(2)
    expect(groups[0].categories.map((category) => category.action)).toEqual([
      'addConcept',
      'addMethod',
      'addFinding',
      'addRelation',
    ])
    expect(groups[0].categories[0].items).toHaveLength(1)
    expect(groups[0].categories[1].items).toHaveLength(1)
    expect(groups[0].categories[2].items).toEqual([])
    expect(groups[0].categories[3].items).toEqual([])
  })

  it('keeps first-seen paper order and provides a fallback for unknown papers', () => {
    const unknownPaperSuggestion = {
      ...suggestionMocks[0],
      id: 'suggestion-unknown-paper',
      paperId: 'paper-unknown',
    }

    const groups = groupSuggestionsByPaper(
      [unknownPaperSuggestion, suggestionMocks[2], suggestionMocks[1]],
      [{ id: 'paper-001', title: '论文一' }],
    )

    expect(groups.map((group) => group.paperId)).toEqual([
      'paper-unknown',
      'paper-003',
      'paper-001',
    ])
    expect(groups[0].paperTitle).toBe('未知论文（paper-unknown）')
  })
})
