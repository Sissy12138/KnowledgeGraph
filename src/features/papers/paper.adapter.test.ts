import { describe, expect, it } from 'vitest'
import type {
  AuthorDetail as AuthorDetailDto,
  PaperSummary as PaperSummaryDto,
} from '../../contracts/v05.types'
import {
  toAuthorDetailView,
  toPaperPageView,
  toPaperSummaryView,
} from './paper.adapter'

const paperSummaryDto: PaperSummaryDto = {
  id: 'paper-adapter',
  title: 'Adapter test paper',
  authors: [
    { authorId: 'author-b', displayName: 'B', rawName: 'B raw', authorOrder: 2 },
    { authorId: 'author-a', displayName: 'A', rawName: 'A raw', authorOrder: 1 },
  ],
  year: 2025,
  doi: '10.1000/adapter',
  journal: {
    name: 'Journal of Adapter Tests',
    issn: '1234-5678',
    metrics: {
      impactFactor: 4.2,
      jcrDataYear: 2024,
      categories: [{ category: 'Neurosciences', quartile: 'Q2' }],
      metricSource: 'JCR',
    },
  },
  status: 'completed',
  latestJobId: 'job-adapter',
  pendingSuggestionCount: 0,
  createdAt: '2026-08-20T08:00:00Z',
  updatedAt: '2026-08-26T09:10:00Z',
}

function authorDetailDto(
  overrides: Partial<AuthorDetailDto> = {},
): AuthorDetailDto {
  return {
    id: 'author-a',
    displayName: 'A',
    nameVariants: ['A raw'],
    externalIds: {
      orcid: null,
      orcidSource: null,
      orcidAuthenticated: false,
    },
    affiliations: [
      { rawText: 'Example Lab', displayName: 'Example Laboratory', rorId: null },
    ],
    identityStatus: 'resolved',
    mergedIntoAuthorId: null,
    paperCount: 2,
    createdAt: '2026-08-20T08:00:00Z',
    updatedAt: '2026-08-26T09:10:00Z',
    ...overrides,
  }
}

describe('paper adapter', () => {
  it('maps v05 authors, journal and derives totalPages', () => {
    const page = toPaperPageView(
      { items: [paperSummaryDto], page: 2, pageSize: 2, total: 5 },
      'mock',
    )

    expect(page.totalPages).toBe(3)
    expect(page.items[0].authors.map((author) => author.id)).toEqual([
      'author-a',
      'author-b',
    ])
    expect(page.items[0].authors.map((author) => author.name)).toEqual(['A', 'B'])
    expect(page.items[0].journal?.impactFactor).toBe(4.2)
    expect(page.items[0].metricSource).toBe('mock')
  })

  it('does not expose unavailable metrics in api mode', () => {
    const paper = toPaperSummaryView(
      {
        ...paperSummaryDto,
        journal: { name: 'J', issn: null, metrics: null },
      },
      'unavailable',
    )

    expect(paper.journal?.impactFactor).toBeNull()
  })

  it('preserves ORCID provenance without treating imported ids as authenticated', () => {
    const author = toAuthorDetailView(
      authorDetailDto({
        externalIds: {
          orcid: '0000-0001',
          orcidSource: 'crossref',
          orcidAuthenticated: false,
        },
      }),
    )

    expect(author.orcid).toEqual({
      value: '0000-0001',
      source: 'crossref',
      authenticated: false,
    })
  })

  it('only exposes authenticated ORCID state for the OAuth source', () => {
    const imported = toAuthorDetailView(
      authorDetailDto({
        externalIds: {
          orcid: '0000-0002',
          orcidSource: 'manual',
          orcidAuthenticated: true,
        },
      }),
    )
    const oauth = toAuthorDetailView(
      authorDetailDto({
        externalIds: {
          orcid: '0000-0003',
          orcidSource: 'orcidOAuth',
          orcidAuthenticated: true,
        },
      }),
    )

    expect(imported.orcid?.authenticated).toBe(false)
    expect(oauth.orcid?.authenticated).toBe(true)
  })

  it('returns zero totalPages when pageSize is zero', () => {
    const page = toPaperPageView(
      { items: [], page: 1, pageSize: 0, total: 5 },
      'unavailable',
    )

    expect(page.totalPages).toBe(0)
  })
})
