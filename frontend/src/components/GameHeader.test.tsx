import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GameHeader } from './GameHeader'

describe('GameHeader', () => {
  it('labels the viewer team first and keeps exact scores in tooltips', () => {
    render(
      <GameHeader
        scores={{ A: 1250, B: 300 }}
        thresholds={{ A: 60, B: 30 }}
        targetScore={5000}
        viewerTeamId="B"
      />,
    )

    const scores = screen.getByRole('list', { name: 'scores' })
    const cards = within(scores).getAllByRole('listitem')
    expect(cards[0]).toHaveAccessibleName('Ваша команда: 300 из 5000 очков. Выход 30 очков')
    expect(cards[1]).toHaveAccessibleName('Команда соперников: 1250 из 5000 очков. Выход 60 очков')
    expect(
      screen.getByRole('tooltip', { name: /300 из 5000 очков.*Выход 30 очков/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tooltip', { name: /1250 из 5000 очков.*Выход 60 очков/ }),
    ).toBeInTheDocument()
  })
})
