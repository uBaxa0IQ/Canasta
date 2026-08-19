import { beforeEach, describe, expect, it } from 'vitest'
import type { GameActionData } from '../lib/protocol'
import { useActionPlaybackStore } from './actionPlaybackStore'

function action(overrides: Partial<GameActionData> = {}): GameActionData {
  return {
    action: 'draw_deck',
    actor_id: 'p1',
    team_id: 'A',
    phase_after: 'ACT',
    turn_player_after: 'p1',
    meld_id: null,
    cards: [],
    drawn_cards: [{ id: 'c1', rank: '7', suit: 'HEARTS' }],
    draw_count: 1,
    discard_count_before: 1,
    team_opened: false,
    threshold_before: 0,
    threshold_after: 0,
    penalty_delta: 0,
    canasta_completed: false,
    deal_completed: false,
    exit_type: null,
    ...overrides,
  }
}

describe('useActionPlaybackStore', () => {
  beforeEach(() => useActionPlaybackStore.getState().reset())

  it('does not enqueue the same server action twice', () => {
    const event = action()
    useActionPlaybackStore.getState().enqueue(event)
    useActionPlaybackStore.getState().enqueue(event)
    expect(useActionPlaybackStore.getState().queue).toHaveLength(1)
  })

  it('advances only the matching playback item', () => {
    useActionPlaybackStore.getState().enqueue(action())
    useActionPlaybackStore
      .getState()
      .enqueue(action({ drawn_cards: [{ id: 'c2', rank: '8', suit: 'CLUBS' }] }))
    const [first, second] = useActionPlaybackStore.getState().queue
    useActionPlaybackStore.getState().advance(first.playbackId)
    expect(useActionPlaybackStore.getState().queue.map((item) => item.playbackId)).toEqual([
      second.playbackId,
    ])
  })
})
