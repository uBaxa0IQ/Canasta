import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DealTransitionLayer } from './DealTransitionLayer'

describe('DealTransitionLayer', () => {
  afterEach(() => vi.useRealTimers())

  it('renders a non-interactive twenty-card transition scene', () => {
    const { container } = render(<DealTransitionLayer />)

    const layer = screen.getByTestId('deal-transition-layer')
    expect(layer).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('.deal-transition-card')).toHaveLength(20)
    expect(container.querySelectorAll('.deal-transition-face.is-front')).toHaveLength(20)
    expect(container.querySelectorAll('.deal-transition-face.is-back')).toHaveLength(20)
  })

  it('removes itself after ten seconds', () => {
    vi.useFakeTimers()
    render(<DealTransitionLayer />)

    expect(screen.getByTestId('deal-transition-layer')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.queryByTestId('deal-transition-layer')).not.toBeInTheDocument()
  })
})
