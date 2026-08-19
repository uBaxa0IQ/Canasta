import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CSSProperties } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TeamZone } from './TeamZone'
import type { Meld } from '../lib/protocol'
import { useDragStore } from '../stores/dragStore'

const melds: Meld[] = [
  {
    id: 'm1',
    team_id: 'A',
    kind: 'SET',
    rank_or_suit_anchor: '4',
    slots: [
      { id: 'c1', rank: '4', suit: 'HEARTS' },
      { id: 'c2', rank: '4', suit: 'SPADES' },
    ],
  },
  {
    id: 'm2',
    team_id: 'A',
    kind: 'SET',
    rank_or_suit_anchor: '9',
    slots: [{ id: 'c3', rank: '9', suit: 'CLUBS' }],
  },
]

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe('TeamZone', () => {
  it('renders one MeldStack per meld under the team heading', () => {
    render(<TeamZone teamId="A" melds={melds} isOwnTeam canStealFrom={false} />)

    expect(screen.getByText('Ваши комбинации')).toBeInTheDocument()
    expect(screen.getByText('4×2')).toBeInTheDocument()
    expect(screen.getByText('9×1')).toBeInTheDocument()
  })

  it('labels the opponents zone with the team id', () => {
    render(<TeamZone teamId="B" melds={[]} isOwnTeam={false} canStealFrom={false} />)

    expect(screen.getByText('Комбинации соперников')).toBeInTheDocument()
    expect(screen.queryByText('Стол пуст')).not.toBeInTheDocument()
  })

  it('does not independently scale meld cards', () => {
    const { container } = render(
      <TeamZone teamId="A" melds={melds} isOwnTeam canStealFrom={false} />,
    )

    expect(container.querySelector<HTMLElement>('.team-zone-strip')?.style.transform).toBe('')
    expect(container.querySelector<HTMLElement>('.team-zone-shell')?.style.height).toBe('')
  })

  it('keeps existing meld positions when a new meld appears', () => {
    const { container, rerender } = render(
      <TeamZone teamId="A" melds={[melds[0]]} isOwnTeam canStealFrom={false} />,
    )
    const first = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    const originalX = first.style.getPropertyValue('--free-x')
    const originalY = first.style.getPropertyValue('--free-y')

    rerender(<TeamZone teamId="A" melds={melds} isOwnTeam canStealFrom={false} />)

    const second = container.querySelector<HTMLElement>('[data-free-meld-id="m2"]')!
    expect(first.style.getPropertyValue('--free-x')).toBe(originalX)
    expect(first.style.getPropertyValue('--free-y')).toBe(originalY)
    expect(second.style.getPropertyValue('--free-x')).not.toBe(originalX)
  })

  it('expands several free-board melds independently', async () => {
    const { container } = render(
      <TeamZone teamId="A" melds={melds} isOwnTeam canStealFrom={false} />,
    )

    expect(container.querySelector('.free-meld-board')).toBeInTheDocument()
    expect(container.querySelectorAll('.meld-stack.is-compact')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Переместить комбинацию/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /4×2 — показать карты/ }))
    await userEvent.click(screen.getByRole('button', { name: /9×1 — показать карты/ }))
    expect(container.querySelector('[aria-label="meld-m1"]')).not.toHaveClass('is-compact')
    expect(container.querySelector('[aria-label="meld-m2"]')).not.toHaveClass('is-compact')
  })

  it('brings the most recently interacted free-board meld to the front', () => {
    const { container } = render(
      <TeamZone teamId="A" melds={melds} isOwnTeam canStealFrom={false} />,
    )
    const first = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    const second = container.querySelector<HTMLElement>('[data-free-meld-id="m2"]')!

    fireEvent.pointerDown(screen.getByRole('button', { name: /4×2 — показать карты/ }))
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(first).toHaveClass('is-frontmost')
    expect(second).not.toHaveClass('is-frontmost')

    fireEvent.pointerDown(screen.getByRole('button', { name: /9×1 — показать карты/ }))
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(first).not.toHaveClass('is-frontmost')
    expect(second).toHaveClass('is-frontmost')

    act(() => {
      useDragStore.getState().startDrag('c1', 'hand', 0, 0)
      useDragStore.getState().moveDrag(0, 0, 'meld:m1')
    })
    expect(first).toHaveClass('is-frontmost')
    expect(second).not.toHaveClass('is-frontmost')
    act(() => useDragStore.getState().endDrag())
  })

  it('moves a free-board meld left, right, and down with document pointer tracking', async () => {
    const { container } = render(
      <TeamZone teamId="A" melds={[melds[0]]} isOwnTeam canStealFrom={false} />,
    )
    const board = container.querySelector<HTMLElement>('.free-meld-board')!
    const item = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 300,
      width: 1000,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      right: 190,
      bottom: 170,
      width: 90,
      height: 120,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 120, clientY: 70 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 600, clientY: 200 })
    await waitFor(() => {
      expect(item.style.getPropertyValue('--free-x')).toBe('62.5%')
      expect(parseFloat(item.style.getPropertyValue('--free-y'))).toBeCloseTo(77.33, 1)
    })

    fireEvent.pointerMove(document, { pointerId: 1, clientX: 30, clientY: 100 })
    await waitFor(() => {
      expect(item.style.getPropertyValue('--free-x')).toBe('5.5%')
    })
    fireEvent.pointerUp(document, { pointerId: 1 })

    const toggle = screen.getByRole('button', { name: /4×2 — показать карты/ })
    fireEvent.click(toggle)
    expect(container.querySelector('[aria-label="meld-m1"]')).toHaveClass('is-compact')
    fireEvent.click(toggle)
    expect(container.querySelector('[aria-label="meld-m1"]')).not.toHaveClass('is-compact')
  })

  it('lets an own meld move below the hand top when it stays beside the panel', async () => {
    const { container } = render(
      <div className="table-frame">
        <TeamZone teamId="A" melds={[melds[0]]} isOwnTeam canStealFrom={false} />
        <section aria-label="hand-area" />
      </div>,
    )
    const board = container.querySelector<HTMLElement>('.free-meld-board')!
    const item = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    const hand = container.querySelector<HTMLElement>('[aria-label="hand-area"]')!
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(400, 200, 90, 120))
    vi.spyOn(hand, 'getBoundingClientRect').mockReturnValue(rect(300, 350, 400, 150))

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 420, clientY: 220 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 100, clientY: 480 })

    await waitFor(() => {
      expect(parseFloat(item.style.getPropertyValue('--free-x'))).toBeCloseTo(12.5, 1)
      expect(parseFloat(item.style.getPropertyValue('--free-y'))).toBeCloseTo(86.4, 1)
    })
    fireEvent.pointerUp(document, { pointerId: 1 })
  })

  it('uses the collapsed hand edge when limiting an own meld above the panel', async () => {
    const { container } = render(
      <div className="table-frame">
        <TeamZone teamId="A" melds={[melds[0]]} isOwnTeam canStealFrom={false} />
        <section aria-label="hand-area" style={{ '--hand-card-h': '100px' } as CSSProperties} />
      </div>,
    )
    const board = container.querySelector<HTMLElement>('.free-meld-board')!
    const item = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    const hand = container.querySelector<HTMLElement>('[aria-label="hand-area"]')!
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(400, 200, 90, 120))
    vi.spyOn(hand, 'getBoundingClientRect').mockReturnValue(rect(300, 300, 400, 150))

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 420, clientY: 220 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 420, clientY: 480 })

    await waitFor(() => {
      expect(parseFloat(item.style.getPropertyValue('--free-y'))).toBeCloseTo(59.2, 1)
    })
    fireEvent.pointerUp(document, { pointerId: 1 })
  })

  it('slides an opponent meld along the partner hand instead of freezing', async () => {
    const { container } = render(
      <div className="table-felt">
        <div className="seat-slot-top" />
        <TeamZone teamId="B" melds={[melds[0]]} isOwnTeam={false} canStealFrom={false} />
      </div>,
    )
    const board = container.querySelector<HTMLElement>('.free-meld-board')!
    const item = container.querySelector<HTMLElement>('[data-free-meld-id="m1"]')!
    const partner = container.querySelector<HTMLElement>('.seat-slot-top')!
    vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 500))
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 90, 120))
    vi.spyOn(partner, 'getBoundingClientRect').mockReturnValue(rect(400, 50, 100, 150))

    fireEvent.pointerDown(item, { pointerId: 1, clientX: 120, clientY: 120 })
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 430, clientY: 150 })
    await waitFor(() => {
      expect(parseFloat(item.style.getPropertyValue('--free-x'))).toBeCloseTo(34.7, 1)
      expect(parseFloat(item.style.getPropertyValue('--free-y'))).toBeCloseTo(38, 1)
    })

    fireEvent.pointerMove(document, { pointerId: 1, clientX: 430, clientY: 200 })
    await waitFor(() => {
      expect(parseFloat(item.style.getPropertyValue('--free-x'))).toBeCloseTo(34.7, 1)
      expect(parseFloat(item.style.getPropertyValue('--free-y'))).toBeCloseTo(48, 1)
    })
    fireEvent.pointerUp(document, { pointerId: 1 })
  })

  it('exposes a drop target only on a real meld compatible with the dragged card', () => {
    const draggedCard = { id: 'dragged-4', rank: '4', suit: 'DIAMONDS' } as const
    useDragStore.getState().startDrag(draggedCard.id, 'hand', 0, 0)
    const { container } = render(
      <TeamZone
        teamId="A"
        melds={melds}
        isOwnTeam
        canDragAdd
        canStealFrom={false}
        handCards={[draggedCard]}
      />,
    )

    expect(container.querySelector('[data-drop-zone="meld:m1"]')).not.toBeNull()
    expect(container.querySelector('[data-drop-zone="meld:m2"]')).not.toBeNull()
    act(() => useDragStore.getState().moveDrag(0, 0, 'meld:m1'))
    expect(container.querySelector('[aria-label="meld-m1"]')).toHaveClass('is-drop-target')
    expect(container.querySelector('[aria-label="meld-m2"]')).not.toHaveClass('is-drop-target')

    act(() => useDragStore.getState().moveDrag(0, 0, 'meld:m2'))
    expect(container.querySelector('[aria-label="meld-m2"]')).not.toHaveClass('is-drop-target')
    act(() => useDragStore.getState().endDrag())
  })
})
