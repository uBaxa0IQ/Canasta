import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MeldStack } from './MeldStack'
import type { Meld } from '../lib/protocol'
import { useDragStore } from '../stores/dragStore'

const openMeld: Meld = {
  id: 'm1',
  team_id: 'A',
  kind: 'SET',
  rank_or_suit_anchor: '4',
  slots: [
    { id: 'c1', rank: '4', suit: 'HEARTS' },
    { id: 'c2', rank: '4', suit: 'SPADES' },
    { id: 'c3', rank: '4', suit: 'CLUBS' },
  ],
}

const dirtySequence: Meld = {
  id: 'm2',
  team_id: 'B',
  kind: 'SEQUENCE',
  rank_or_suit_anchor: 'SPADES:5',
  slots: [
    { id: 'c4', rank: '5', suit: 'SPADES' },
    { id: 'w1', rank: 'JOKER', suit: null },
    { id: 'c5', rank: '7', suit: 'SPADES' },
  ],
}

describe('MeldStack', () => {
  it('shows every card of the meld with a caption', () => {
    render(<MeldStack meld={openMeld} isOwnTeam canStealFrom={false} />)

    expect(screen.getByText('4♥')).toBeInTheDocument()
    expect(screen.getByText('4♠')).toBeInTheDocument()
    expect(screen.getByText('4♣')).toBeInTheDocument()
    expect(screen.getByText('4×3')).toBeInTheDocument()
  })

  it('renders a compact open meld as a face-up card pile', () => {
    const { container } = render(
      <MeldStack
        meld={openMeld}
        isOwnTeam
        canStealFrom={false}
        compact
        stackCompact
        onToggleCompact={() => undefined}
      />,
    )

    expect(container.querySelector('[data-card-stack="meld"]')).toHaveAttribute(
      'data-stack-depth',
      '3',
    )
    expect(container.querySelectorAll('[data-card-stack="meld"] > .card-pile-layer')).toHaveLength(
      3,
    )
  })

  it('captions a sequence with its suit and rank range', () => {
    render(<MeldStack meld={dirtySequence} isOwnTeam={false} canStealFrom={false} />)

    expect(screen.getByText('♠ 5–7')).toBeInTheDocument()
  })

  it('makes opponent wild cards drop targets without making them clickable', () => {
    const { container } = render(<MeldStack meld={dirtySequence} isOwnTeam={false} canStealFrom />)

    expect(screen.queryByRole('button', { name: 'JOKER' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('JOKER')).toHaveAttribute('data-drop-zone', 'wild:m2:w1')

    act(() => {
      useDragStore.getState().startDrag('hand-card', 'hand', 0, 0)
      useDragStore.getState().moveDrag(0, 0, 'wild:m2:w1')
    })
    expect(screen.getByLabelText('JOKER')).toHaveClass('is-selected')
    expect(container.querySelector('[aria-label="meld-m2"]')).not.toHaveClass('is-drop-target')
    act(() => useDragStore.getState().endDrag())
  })

  it('does not show an add button on opponent melds', () => {
    render(<MeldStack meld={openMeld} isOwnTeam={false} canStealFrom={false} />)

    expect(screen.queryByText('Доложить сюда')).not.toBeInTheDocument()
  })

  const closedCanasta: Meld = {
    id: 'm3',
    team_id: 'A',
    kind: 'SET',
    rank_or_suit_anchor: 'K',
    slots: [
      { id: 'k1', rank: 'K', suit: 'HEARTS' },
      { id: 'k2', rank: 'K', suit: 'SPADES' },
      { id: 'k3', rank: 'K', suit: 'CLUBS' },
      { id: 'k4', rank: 'K', suit: 'DIAMONDS' },
      { id: 'k5', rank: 'K', suit: 'HEARTS' },
      { id: 'k6', rank: 'K', suit: 'SPADES' },
      { id: 'w2', rank: '2', suit: 'HEARTS' },
    ],
  }

  it('renders a completed canasta collapsed into a pile', () => {
    const { container } = render(<MeldStack meld={closedCanasta} isOwnTeam canStealFrom={false} />)

    // The pile uses the same three layers as the other table stacks, with
    // real face-up canasta cards on every layer.
    expect(container.querySelector('[data-card-stack="canasta"]')).toHaveAttribute(
      'data-stack-depth',
      '3',
    )
    expect(
      container.querySelectorAll('[data-card-stack="canasta"] > .card-pile-layer'),
    ).toHaveLength(3)
    expect(screen.getByText('K×7')).toBeInTheDocument()
    expect(container.querySelector('.canasta-count')).not.toBeInTheDocument()
    expect(screen.getByText('Грязная').tagName).toBe('LEGEND')
    expect(screen.queryByText('Грязная канаста')).not.toBeInTheDocument()
    expect(screen.getByText('K♥')).toBeInTheDocument()
    expect(screen.getByText('K♠')).toBeInTheDocument()
    expect(screen.getByText('2♥')).toBeInTheDocument()
    expect(screen.queryByText('10 очков')).not.toBeInTheDocument()
  })

  it('expands a collapsed canasta on click and lets it collapse back', async () => {
    render(<MeldStack meld={closedCanasta} isOwnTeam={false} canStealFrom />)

    await userEvent.click(screen.getByRole('button', { name: /показать карты/i }))
    // all cards visible; the wild is a drop target, not a button
    expect(screen.getByText('Грязная канаста').tagName).toBe('LEGEND')
    expect(screen.getAllByText('K♥')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '2♥' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('2♥')).toHaveAttribute('data-drop-zone', 'wild:m3:w2')

    await userEvent.click(screen.getByRole('button', { name: 'meld-m3' }))
    expect(screen.getByText('K♥')).toBeInTheDocument()
  })

  it('keeps a collapsed canasta folded while dragging from hand', () => {
    render(<MeldStack meld={closedCanasta} isOwnTeam={false} canStealFrom />)

    useDragStore.getState().startDrag('hand-card', 'hand', 0, 0)
    expect(screen.getByRole('button', { name: /показать карты/i })).toBeInTheDocument()
    expect(screen.getByText('K♥')).toBeInTheDocument()
    useDragStore.getState().endDrag()
  })

  it('exposes a steal drop zone on a collapsed canasta with one wild', () => {
    render(<MeldStack meld={closedCanasta} isOwnTeam={false} canStealFrom />)

    expect(screen.getByRole('button', { name: /показать карты/i })).toHaveAttribute(
      'data-drop-zone',
      'wild:m3:w2',
    )
  })
})
