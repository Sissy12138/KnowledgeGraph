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
    render(
      <GraphOverlayControls
        view="author"
        showRelatedConcepts={false}
        showRelatedMethods={false}
        onShowRelatedConceptsChange={onConceptsChange}
        onShowRelatedMethodsChange={onMethodsChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: '显示相关概念' }))
    await user.click(screen.getByRole('button', { name: '显示相关方法' }))
    expect(onConceptsChange).toHaveBeenCalledWith(true)
    expect(onMethodsChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: '显示相关作者' })).not.toBeInTheDocument()
  })

  it('文献引用视图只提供相关概念开关', async () => {
    const user = userEvent.setup()
    const onConceptsChange = vi.fn()
    const paperProps = {
      view: 'paper' as const,
      showRelatedConcepts: false,
      onShowRelatedConceptsChange: onConceptsChange,
    }
    render(<GraphOverlayControls {...paperProps} />)

    const concepts = screen.getByRole('button', { name: '显示相关概念' })
    expect(concepts).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: '显示相关方法' })).not.toBeInTheDocument()
    await user.click(concepts)
    expect(onConceptsChange).toHaveBeenCalledWith(true)
  })
})
