import { create } from 'zustand'
import type { GameUiEvent } from '../lib/gameStateDiff'

export interface GameFeedbackEvent extends GameUiEvent {
  id: string
}

interface GameFeedbackStore {
  latestEvent: GameFeedbackEvent | null
  newCardIds: string[]
  recentActorId: string | null
  recentTeamId: string | null
  recentDiscardCardId: string | null
  publish: (event: GameUiEvent | null, newCardIds: string[]) => void
  acknowledgeNewCard: (cardId: string) => void
  clearLatestEvent: (id: string) => void
  reset: () => void
}

let nextFeedbackId = 0

export const useGameFeedbackStore = create<GameFeedbackStore>((set) => ({
  latestEvent: null,
  newCardIds: [],
  recentActorId: null,
  recentTeamId: null,
  recentDiscardCardId: null,

  publish: (event, newCardIds) =>
    set((state) => ({
      latestEvent: event ? { ...event, id: `f${nextFeedbackId++}` } : null,
      newCardIds: [...new Set([...state.newCardIds, ...newCardIds])],
      recentActorId: event?.actorId ?? null,
      recentTeamId: event?.teamId ?? null,
      recentDiscardCardId: event?.discardCardId ?? null,
    })),

  acknowledgeNewCard: (cardId) =>
    set((state) => ({ newCardIds: state.newCardIds.filter((id) => id !== cardId) })),
  clearLatestEvent: (id) =>
    set((state) => (state.latestEvent?.id === id ? { latestEvent: null } : {})),
  reset: () =>
    set({
      latestEvent: null,
      newCardIds: [],
      recentActorId: null,
      recentTeamId: null,
      recentDiscardCardId: null,
    }),
}))
