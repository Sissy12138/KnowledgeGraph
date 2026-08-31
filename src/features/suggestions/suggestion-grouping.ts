import type { Suggestion, SuggestionAction } from './suggestion.types'

export const suggestionActions: SuggestionAction[] = [
  'addConcept',
  'addMethod',
  'addFinding',
  'addRelation',
]

const actionLabels: Record<SuggestionAction, string> = {
  addConcept: '概念新增',
  addMethod: '方法新增',
  addFinding: '发现新增',
  addRelation: '关系新增',
}

export interface SuggestionCategoryGroup {
  action: SuggestionAction
  label: string
  items: Suggestion[]
}

export interface SuggestionPaperGroup {
  paperId: string
  paperTitle: string
  total: number
  categories: SuggestionCategoryGroup[]
}

/** 将后端扁平建议按论文和固定的四种知识类型整理，且不修改输入数据。 */
export function groupSuggestionsByPaper(
  suggestions: Suggestion[],
  papers: Array<{ id: string; title: string }>,
): SuggestionPaperGroup[] {
  const titleByPaperId = new Map(papers.map((paper) => [paper.id, paper.title]))
  const suggestionsByPaperId = new Map<string, Suggestion[]>()

  suggestions.forEach((suggestion) => {
    const paperSuggestions = suggestionsByPaperId.get(suggestion.paperId) ?? []
    paperSuggestions.push(suggestion)
    suggestionsByPaperId.set(suggestion.paperId, paperSuggestions)
  })

  return Array.from(suggestionsByPaperId, ([paperId, items]) => ({
    paperId,
    paperTitle: titleByPaperId.get(paperId) ?? `未知论文（${paperId}）`,
    total: items.length,
    categories: suggestionActions.map((action) => ({
      action,
      label: actionLabels[action],
      items: items.filter((item) => item.action === action),
    })),
  }))
}
