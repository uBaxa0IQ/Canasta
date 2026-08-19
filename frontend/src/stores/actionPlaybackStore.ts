import { create } from 'zustand'
import type { GameActionData } from '../lib/protocol'

export interface QueuedGameAction extends GameActionData {
  playbackId: string
}

interface ActionPlaybackStore {
  queue: QueuedGameAction[]
  lastFingerprint: string | null
  enqueue: (event: GameActionData) => void
  advance: (playbackId: string) => void
  reset: () => void
}

let nextPlaybackId = 0

function actionFingerprint(event: GameActionData): string {
  return [
    event.action,
    event.actor_id,
    event.meld_id ?? '',
    event.cards.map((card) => card.id).join(','),
    event.drawn_cards.map((card) => card.id).join(','),
    event.turn_player_after,
    event.phase_after,
  ].join('|')
}

export const useActionPlaybackStore = create<ActionPlaybackStore>((set) => ({
  queue: [],
  lastFingerprint: null,
  enqueue: (event) =>
    set((state) => {
      const fingerprint = actionFingerprint(event)
      if (fingerprint === state.lastFingerprint) return state
      return {
        lastFingerprint: fingerprint,
        queue: [...state.queue, { ...event, playbackId: `action-${nextPlaybackId++}` }].slice(-12),
      }
    }),
  advance: (playbackId) =>
    set((state) => ({
      queue:
        state.queue[0]?.playbackId === playbackId
          ? state.queue.slice(1)
          : state.queue.filter((event) => event.playbackId !== playbackId),
    })),
  reset: () => set({ queue: [], lastFingerprint: null }),
}))
