import { beforeEach, describe, expect, it } from 'vitest'
import { useGameFeedbackStore } from './gameFeedbackStore'

describe('gameFeedbackStore received cards', () => {
  beforeEach(() => useGameFeedbackStore.getState().reset())

  it('keeps received cards across later events until each one is acknowledged', () => {
    const store = useGameFeedbackStore.getState()

    store.publish(null, ['c1'])
    useGameFeedbackStore.getState().publish(null, [])
    useGameFeedbackStore.getState().publish(null, ['c2'])
    expect(useGameFeedbackStore.getState().newCardIds).toEqual(['c1', 'c2'])

    useGameFeedbackStore.getState().acknowledgeNewCard('c1')
    expect(useGameFeedbackStore.getState().newCardIds).toEqual(['c2'])
  })
})
