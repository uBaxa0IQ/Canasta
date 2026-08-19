import { create } from 'zustand'
import type { DealResultMessage, DealScoreBreakdown, GameStateData } from '../lib/protocol'

interface DealResult {
  dealNumber: number
  scoresBreakdown: Record<string, DealScoreBreakdown>
  teamScoresAfter: Record<string, number>
  nextDeal: boolean
  transitionEndsAt: number | null
}

interface GameStore {
  state: GameStateData | null
  lastDealResult: DealResult | null
  winnerTeamId: string | null
  lastActionError: string | null
  timedOutPlayerId: string | null
  applyGameState: (data: GameStateData) => void
  applyDealResult: (data: DealResultMessage['data']) => void
  applyGameOver: (winnerTeamId: string) => void
  applyActionError: (reason: string) => void
  applyTurnTimerExpired: (playerId: string) => void
  clearTimedOutPlayer: (playerId: string) => void
  dismissActionError: () => void
  dismissDealResult: () => void
  reset: () => void
}

// Mirrors the server's game_state verbatim (plan section 14, useGameStore):
// mutated only by the WS message handler, never directly by components.
export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  lastDealResult: null,
  winnerTeamId: null,
  lastActionError: null,
  timedOutPlayerId: null,

  applyGameState: (data) => {
    // FR-35/37: the turn moving on (normal play or a host skip-with-penalty)
    // always supersedes a stale timeout flag, even if no player_connection
    // message happens to arrive in between.
    const previousTurnPlayer = get().state?.turn_player_id
    set({
      state: data,
      lastActionError: null,
      timedOutPlayerId:
        previousTurnPlayer !== undefined && previousTurnPlayer !== data.turn_player_id
          ? null
          : get().timedOutPlayerId,
    })
  },

  applyDealResult: (data) =>
    set({
      lastDealResult: {
        dealNumber: data.deal_number,
        scoresBreakdown: data.scores_breakdown,
        teamScoresAfter: data.team_scores_after,
        nextDeal: data.next_deal,
        transitionEndsAt: data.transition_ends_at ?? null,
      },
    }),

  applyGameOver: (winnerTeamId) => set({ winnerTeamId }),

  applyActionError: (reason) => set({ lastActionError: reason }),
  applyTurnTimerExpired: (playerId) => set({ timedOutPlayerId: playerId }),
  clearTimedOutPlayer: (playerId) =>
    set((s) => (s.timedOutPlayerId === playerId ? { timedOutPlayerId: null } : {})),
  dismissActionError: () => set({ lastActionError: null }),
  dismissDealResult: () => set({ lastDealResult: null }),

  reset: () =>
    set({
      state: null,
      lastDealResult: null,
      winnerTeamId: null,
      lastActionError: null,
      timedOutPlayerId: null,
    }),
}))
