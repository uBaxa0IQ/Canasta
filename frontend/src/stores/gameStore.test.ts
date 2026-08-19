import { beforeEach, describe, expect, it } from 'vitest'
import type { GameStateData } from '../lib/protocol'
import { useGameStore } from './gameStore'

function gameState(overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    hands: { p1: [{ id: 'c1', rank: '7', suit: 'HEARTS' }], p2: 11 },
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

describe('useGameStore', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
  })

  it('mirrors an incoming game_state snapshot', () => {
    useGameStore.getState().applyGameState(gameState())
    expect(useGameStore.getState().state?.turn_player_id).toBe('p1')
  })

  const breakdown = {
    table_points: 220,
    canasta_bonus: 500,
    hand_penalty: -25,
    three_bonus: 100,
    exit_bonus: 200,
    total: 995,
  }

  it('records a deal result', () => {
    useGameStore.getState().applyDealResult({
      deal_number: 1,
      scores_breakdown: { A: breakdown },
      team_scores_after: { A: 520, B: 0 },
      next_deal: true,
    })

    const result = useGameStore.getState().lastDealResult
    expect(result?.dealNumber).toBe(1)
    expect(result?.scoresBreakdown.A).toEqual(breakdown)
    expect(result?.teamScoresAfter).toEqual({ A: 520, B: 0 })
    expect(result?.nextDeal).toBe(true)
    expect(result?.transitionEndsAt).toBeNull()
  })

  it('dismisses a deal result', () => {
    useGameStore.getState().applyDealResult({
      deal_number: 1,
      scores_breakdown: { A: breakdown },
      team_scores_after: { A: 520, B: 0 },
      next_deal: true,
    })
    useGameStore.getState().dismissDealResult()

    expect(useGameStore.getState().lastDealResult).toBeNull()
  })

  it('records the winning team on game over', () => {
    useGameStore.getState().applyGameOver('A')
    expect(useGameStore.getState().winnerTeamId).toBe('A')
  })

  it('records and dismisses an action error', () => {
    useGameStore.getState().applyActionError('it is not your turn')
    expect(useGameStore.getState().lastActionError).toBe('it is not your turn')

    useGameStore.getState().dismissActionError()
    expect(useGameStore.getState().lastActionError).toBeNull()
  })

  it('clears a stale action error once a new game_state arrives', () => {
    useGameStore.getState().applyActionError('it is not your turn')
    useGameStore.getState().applyGameState(gameState())
    expect(useGameStore.getState().lastActionError).toBeNull()
  })

  it('records a turn timeout and clears it once the turn moves on', () => {
    useGameStore.getState().applyGameState(gameState({ turn_player_id: 'p1' }))
    useGameStore.getState().applyTurnTimerExpired('p1')
    expect(useGameStore.getState().timedOutPlayerId).toBe('p1')

    useGameStore.getState().applyGameState(gameState({ turn_player_id: 'p1' }))
    expect(useGameStore.getState().timedOutPlayerId).toBe('p1')

    useGameStore.getState().applyGameState(gameState({ turn_player_id: 'p2' }))
    expect(useGameStore.getState().timedOutPlayerId).toBeNull()
  })

  it('clears a timed-out player only when it matches (e.g. on reconnect)', () => {
    useGameStore.getState().applyTurnTimerExpired('p1')
    useGameStore.getState().clearTimedOutPlayer('p2')
    expect(useGameStore.getState().timedOutPlayerId).toBe('p1')

    useGameStore.getState().clearTimedOutPlayer('p1')
    expect(useGameStore.getState().timedOutPlayerId).toBeNull()
  })

  it('resets to initial state', () => {
    useGameStore.getState().applyGameState(gameState())
    useGameStore.getState().applyGameOver('A')
    useGameStore.getState().reset()

    expect(useGameStore.getState().state).toBeNull()
    expect(useGameStore.getState().winnerTeamId).toBeNull()
  })
})
