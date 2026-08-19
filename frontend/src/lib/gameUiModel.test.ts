import { describe, expect, it } from 'vitest'
import { buildGameUiModel } from './gameUiModel'
import type { GameStateData } from './protocol'

function baseState(overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    hands: { p1: [] },
    melds: { A: [], B: [] },
    deck_count: 40,
    discard_pile: [],
    discard_count: 0,
    scores: { A: 0, B: 0 },
    thresholds: { A: 50, B: 50 },
    turn_player_id: 'p1',
    turn_phase: 'DRAW',
    must_meld_after_pickup: false,
    melds_created_this_turn: 0,
    pending_penalty: false,
    team_opened: { A: false, B: false },
    turn_accumulator: { A: 0, B: 0 },
    ...overrides,
  }
}

describe('buildGameUiModel', () => {
  it('allows discard after deck draw without melding', () => {
    const ui = buildGameUiModel({
      gameState: baseState({ turn_phase: 'ACT' }),
      isMyTurn: true,
      gameOver: false,
      viewerTeamId: 'A',
      selectedCardCount: 1,
    })
    expect(ui.canDiscard).toBe(true)
  })

  it('still allows discard after discard pickup without new meld', () => {
    const ui = buildGameUiModel({
      gameState: baseState({
        turn_phase: 'ACT',
        must_meld_after_pickup: true,
        melds_created_this_turn: 0,
      }),
      isMyTurn: true,
      gameOver: false,
      viewerTeamId: 'A',
      selectedCardCount: 0,
    })
    expect(ui.canDiscard).toBe(true)
  })

  it('blocks taking discard when top card is a three', () => {
    const ui = buildGameUiModel({
      gameState: baseState({
        discard_pile: [{ id: 't1', rank: '3', suit: 'SPADES' }],
        discard_count: 1,
      }),
      isMyTurn: true,
      gameOver: false,
      viewerTeamId: 'A',
      selectedCardCount: 0,
    })
    expect(ui.canTakeDiscard).toBe(false)
    expect(ui.discardBlockedReason).toMatch(/тройка/)
  })
})
