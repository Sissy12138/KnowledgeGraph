import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GraphOverlayControls from './GraphOverlayControls'

describe('GraphOverlayControls', () => {
  it('显示两个独立的受控开关并报告切换意图', async () => {
    const user = userEvent.setup()
    const onAuthorsChange = vi.fn()
    const onMethodsChange = vi.fn()
    const { rerender } = render(
      <GraphOverlayControls
        view="concept"
        showRelatedAuthors={false}
        showRelatedMethods={false}
        onShowRelatedAuthorsChange={onAuthorsChange}
        onShowRelatedMethodsChange={onMethodsChange}
      />,
    )

    const authors = screen.getByRole('button', { name: '显示相关作者' })
    const methods = screen.getByRole('button', { name: '显示相关方法' })
    expect(authors).toHaveAttribute('aria-pressed', 'false')
    expect(methods).toHaveAttribute('aria-pressed', 'false')

    await user.click(authors)
    await user.click(methods)
    expect(onAuthorsChange).toHaveBeenCalledWith(true)
    expect(onMethodsChange).toHaveBeenCalledWith(true)

    rerender(
      <GraphOverlayControls
        view="concept"
        showRelatedAuthors
        showRelatedMethods
        onShowRelatedAuthorsChange={onAuthorsChange}
        onShowRelatedMethodsChange={onMethodsChange}
      />,
    )
    expect(authors).toHaveAttribute('aria-pressed', 'true')
    expect(methods).toHaveAttribute('aria-pressed', 'true')
  })

  it('作者视图提供相关概念和相关方法开关', async () => {
    const user = userEvent.setup()
    const onConceptsChange = vi.fn()
    const onMethodsChange = vi.fn()
    const onAuthorModeChange = vi.fn()
    const onExpandedSelectedAuthorChange = vi.fn()
    render(
      <GraphOverlayControls
        view="author"
        authorMode="coreBridge"
        canExpandSelectedAuthor
        expandedSelectedAuthor={false}
        showRelatedConcepts={false}
        showRelatedMethods={false}
        onAuthorModeChange={onAuthorModeChange}
        onExpandedSelectedAuthorChange={onExpandedSelectedAuthorChange}
        onShowRelatedConceptsChange={onConceptsChange}
        onShowRelatedMethodsChange={onMethodsChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    await user.click(screen.getByRole('button', { name: '显示相关方法' }))
    expect(onConceptsChange).toHaveBeenCalledWith(true)
    expect(onMethodsChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: '显示相关作者' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: '作者网络范围' }), 'all')
    await user.click(screen.getByRole('button', { name: '展开当前作者全部合作者' }))
    expect(onAuthorModeChange).toHaveBeenCalledWith('all')
    expect(onExpandedSelectedAuthorChange).toHaveBeenCalledWith(true)
  })

  it('方法视图提供相关概念开关', async () => {
    const user = userEvent.setup()
    const onConceptsChange = vi.fn()
    render(
      <GraphOverlayControls
        view="method"
        showRelatedConcepts={false}
        onShowRelatedConceptsChange={onConceptsChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    expect(onConceptsChange).toHaveBeenCalledWith(true)
  })

  it('文献引用视图提供相关概念和相关方法开关', async () => {
    const user = userEvent.setup()
    const onConceptsChange = vi.fn()
    const onMethodsChange = vi.fn()
    const paperProps = {
      view: 'paper' as const,
      showRelatedConcepts: false,
      showRelatedMethods: false,
      onShowRelatedConceptsChange: onConceptsChange,
      onShowRelatedMethodsChange: onMethodsChange,
    }
    render(<GraphOverlayControls {...paperProps} />)

    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    const methods = screen.getByRole('button', { name: '显示相关方法' })
    expect(concepts).toHaveAttribute('aria-pressed', 'false')
    expect(methods).toHaveAttribute('aria-pressed', 'false')
    await user.click(concepts)
    await user.click(methods)
    expect(onConceptsChange).toHaveBeenCalledWith(true)
    expect(onMethodsChange).toHaveBeenCalledWith(true)
  })
})
