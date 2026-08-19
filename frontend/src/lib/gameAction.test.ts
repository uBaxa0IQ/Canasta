import { describe, expect, it } from 'vitest'
import { gameActionToUiEvent } from './gameAction'
import type { GameActionData } from './protocol'

function action(overrides: Partial<GameActionData> = {}): GameActionData {
  return {
    action: 'add_to_meld',
    actor_id: 'p2',
    team_id: 'B',
    phase_after: 'ACT',
    turn_player_after: 'p2',
    meld_id: 'm1',
    cards: [{ id: 'c1', rank: '7', suit: 'HEARTS' }],
    drawn_cards: [],
    draw_count: 0,
    discard_count_before: 1,
    team_opened: false,
    threshold_before: 10,
    threshold_after: 15,
    penalty_delta: 0,
    canasta_completed: false,
    deal_completed: false,
    exit_type: null,
    ...overrides,
  }
}

describe('gameActionToUiEvent', () => {
  it('preserves the exact changed meld and threshold progress', () => {
    expect(gameActionToUiEvent(action(), 'p1', { p2: 'Bob' })).toMatchObject({
      type: 'meld',
      actorId: 'p2',
      teamId: 'B',
      meldId: 'm1',
      cardIds: ['c1'],
      thresholdBefore: 10,
      thresholdAfter: 15,
    })
  })

  it('recognizes a wild replacement even though hand and meld sizes stay equal', () => {
    expect(
      gameActionToUiEvent(
        action({
          action: 'steal_wild',
          replacement_card_id: 'c1',
          stolen_card_id: 'w1',
          drawn_cards: [{ id: 'w1', rank: '2', suit: 'SPADES' }],
        }),
        'p1',
        { p2: 'Bob' },
      ),
    ).toMatchObject({
      type: 'steal_wild',
      meldId: 'm1',
      cardIds: ['c1', 'w1'],
    })
  })
})
