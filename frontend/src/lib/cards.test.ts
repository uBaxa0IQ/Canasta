import { describe, expect, it } from 'vitest'
import { canAddCardToMeld, cardPointsLabel, compareForHand } from './cards'
import type { Card, Meld } from './protocol'

describe('cardPointsLabel', () => {
  it('matches regular and wild card values from the game engine', () => {
    expect(cardPointsLabel({ id: 'c1', rank: '7', suit: 'HEARTS' })).toBe('5 очков')
    expect(cardPointsLabel({ id: 'c2', rank: 'A', suit: 'SPADES' })).toBe('10 очков')
    expect(cardPointsLabel({ id: 'c3', rank: '2', suit: 'CLUBS' })).toBe('10 очков')
    expect(cardPointsLabel({ id: 'c4', rank: 'JOKER', suit: null })).toBe('50 очков')
  })

  it('labels red and black threes as special scoring cards', () => {
    expect(cardPointsLabel({ id: 'r3', rank: '3', suit: 'DIAMONDS' })).toBe('+100 очков')
    expect(cardPointsLabel({ id: 'b3', rank: '3', suit: 'CLUBS' })).toBe('−100 очков')
  })
})

describe('compareForHand', () => {
  it('keeps wilds left and threes right while sorting regular ranks low to high', () => {
    const cards: Card[] = [
      { id: 'ace', rank: 'A', suit: 'HEARTS' },
      { id: 'three', rank: '3', suit: 'HEARTS' },
      { id: 'seven', rank: '7', suit: 'HEARTS' },
      { id: 'two', rank: '2', suit: 'HEARTS' },
      { id: 'four', rank: '4', suit: 'HEARTS' },
      { id: 'joker', rank: 'JOKER', suit: null },
    ]

    expect([...cards].sort(compareForHand).map((card) => card.id)).toEqual([
      'joker',
      'two',
      'four',
      'seven',
      'ace',
      'three',
    ])
  })
})

describe('canAddCardToMeld', () => {
  const setMeld: Meld = {
    id: 'set',
    team_id: 'A',
    kind: 'SET',
    rank_or_suit_anchor: '7',
    slots: [
      { id: 's1', rank: '7', suit: 'SPADES' },
      { id: 's2', rank: '7', suit: 'HEARTS' },
      { id: 'sw', rank: 'JOKER', suit: null },
    ],
  }

  it('accepts only matching natural cards and a legal number of wilds in a set', () => {
    expect(canAddCardToMeld(setMeld, { id: 'ok', rank: '7', suit: 'CLUBS' })).toBe(true)
    expect(canAddCardToMeld(setMeld, { id: 'wrong', rank: '8', suit: 'CLUBS' })).toBe(false)
    expect(canAddCardToMeld(setMeld, { id: 'wild', rank: '2', suit: 'CLUBS' })).toBe(true)

    const balanced: Meld = {
      ...setMeld,
      slots: [
        { id: 's1', rank: '7', suit: 'SPADES' },
        { id: 'sw', rank: 'JOKER', suit: null },
      ],
    }
    expect(canAddCardToMeld(balanced, { id: 'extra-wild', rank: '2', suit: 'CLUBS' })).toBe(false)
  })

  it('checks suit, duplicates, range and the completed-canasta limit', () => {
    const sequence: Meld = {
      id: 'sequence',
      team_id: 'A',
      kind: 'SEQUENCE',
      rank_or_suit_anchor: 'SPADES:5',
      slots: [
        { id: 'q1', rank: '5', suit: 'SPADES' },
        { id: 'q2', rank: '6', suit: 'SPADES' },
        { id: 'q3', rank: '7', suit: 'SPADES' },
      ],
    }
    expect(canAddCardToMeld(sequence, { id: 'q4', rank: '8', suit: 'SPADES' })).toBe(true)
    expect(canAddCardToMeld(sequence, { id: 'duplicate', rank: '6', suit: 'SPADES' })).toBe(false)
    expect(canAddCardToMeld(sequence, { id: 'wrong-suit', rank: '8', suit: 'HEARTS' })).toBe(false)
    expect(canAddCardToMeld(sequence, { id: 'too-far', rank: '10', suit: 'SPADES' })).toBe(false)

    const closed = { ...setMeld, slots: Array(7).fill(setMeld.slots[0]) }
    expect(canAddCardToMeld(closed, { id: 'eighth', rank: '7', suit: 'DIAMONDS' })).toBe(false)
  })
})
