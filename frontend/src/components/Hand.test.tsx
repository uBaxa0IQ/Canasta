import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Hand } from './Hand'
import type { Card } from '../lib/protocol'
import { useDragStore } from '../stores/dragStore'

const cards: Card[] = [
  { id: 'c1', rank: '7', suit: 'HEARTS' },
  { id: 'c2', rank: 'JOKER', suit: null },
]

function renderHand(overrides: Partial<Parameters<typeof Hand>[0]> = {}) {
  return render(
    <Hand
      cards={cards}
      selectedIds={[]}
      autoSort={false}
      onToggleAutoSort={vi.fn()}
      onToggleCard={vi.fn()}
      onCardDrop={vi.fn()}
      {...overrides}
    />,
  )
}

describe('Hand', () => {
  it('renders every card with its rank and suit plus the card count', () => {
    renderHand()

    expect(screen.getByText('7♥')).toBeInTheDocument()
    expect(screen.getByText('JOKER')).toBeInTheDocument()
    expect(screen.getByText('2 карты')).toBeInTheDocument()
  })

  it('marks selected cards as pressed', () => {
    renderHand({ selectedIds: ['c1'] })

    expect(screen.getByRole('button', { name: '7♥' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'JOKER' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles a card on click', async () => {
    const onToggleCard = vi.fn()
    renderHand({ onToggleCard })

    await userEvent.click(screen.getByText('7♥'))

    expect(onToggleCard).toHaveBeenCalledWith('c1')
  })

  it('does not expose manual sort buttons', () => {
    renderHand()

    expect(screen.queryByText('Ранг')).not.toBeInTheDocument()
    expect(screen.queryByText('Масть')).not.toBeInTheDocument()
  })

  it('switches between manual and auto sort modes', async () => {
    const onToggleAutoSort = vi.fn()
    renderHand({ onToggleAutoSort })

    await userEvent.click(screen.getByRole('switch', { name: 'Автосортировка' }))
    expect(onToggleAutoSort).toHaveBeenCalledTimes(1)
  })

  it('uses a pulsing turn state only after drawing', () => {
    const { rerender } = renderHand({ isMyTurn: true, isActionPhase: true })
    const hand = screen.getByLabelText('hand-area')

    expect(hand).toHaveClass('is-my-turn', 'is-action-phase')

    rerender(
      <Hand
        cards={cards}
        selectedIds={[]}
        isMyTurn
        isActionPhase={false}
        autoSort={false}
        onToggleAutoSort={vi.fn()}
        onToggleCard={vi.fn()}
        onCardDrop={vi.fn()}
      />,
    )
    expect(hand).toHaveClass('is-my-turn')
    expect(hand).not.toHaveClass('is-action-phase')
  })

  it('collapses while a card is being dragged from the hand', () => {
    renderHand()
    const hand = screen.getByLabelText('hand-area')

    act(() => useDragStore.getState().startDrag('c1', 'hand', 10, 10))
    expect(hand).toHaveClass('is-dragging-card')

    act(() => useDragStore.getState().endDrag())
    expect(hand).not.toHaveClass('is-dragging-card')
  })

  it('acknowledges each received card when it is first hovered', async () => {
    const onAcknowledgeNewCard = vi.fn()
    renderHand({ newCardIds: ['c1'], onAcknowledgeNewCard })

    const card = screen.getByRole('button', { name: '7♥' })
    expect(card.querySelector('.playing-card')).toHaveClass('is-received-card')

    await userEvent.hover(card)
    expect(onAcknowledgeNewCard).toHaveBeenCalledWith('c1')
  })
})
