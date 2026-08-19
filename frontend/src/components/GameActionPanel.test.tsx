import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { GameActionPanel } from './GameActionPanel'

const baseProps = {
  canCreateMeld: false,
  selectedCount: 0,
  createWildPlacement: null,
  createWildSide: 'low' as const,
  onCreateWildSideChange: vi.fn(),
  onCreateMeld: vi.fn(),
}

describe('GameActionPanel', () => {
  it('stays hidden when not visible', () => {
    render(<GameActionPanel {...baseProps} visible={false} phase="DRAW" />)
    expect(screen.queryByText('Новая комбинация')).not.toBeInTheDocument()
    expect(screen.getByLabelText('actions')).toHaveAttribute('aria-hidden')
  })

  it('shows wild placement choices in act phase', async () => {
    const onCreateWildSideChange = vi.fn()
    render(
      <GameActionPanel
        {...baseProps}
        visible
        phase="ACT"
        canCreateMeld
        selectedCount={3}
        createWildPlacement={{ lowLabel: '6♠', highLabel: '9♠' }}
        onCreateWildSideChange={onCreateWildSideChange}
      />,
    )

    expect(screen.getByText('6♠')).toBeInTheDocument()
    await userEvent.click(screen.getByText('9♠'))
    expect(onCreateWildSideChange).toHaveBeenCalledWith('high')
  })
})
