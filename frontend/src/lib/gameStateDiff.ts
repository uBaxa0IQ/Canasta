import { canastaStatus, cardLabel } from './cards'
import type { Card, GameStateData, Meld } from './protocol'

export type GameUiEventType =
  | 'draw_deck'
  | 'draw_discard'
  | 'discard'
  | 'meld'
  | 'canasta'
  | 'rollback'
  | 'steal_wild'
  | 'penalty'
  | 'turn'

export interface GameUiEvent {
  type: GameUiEventType
  text: string
  actorId?: string
  teamId?: string
  cardIds?: string[]
  discardCardId?: string
  meldId?: string
  teamOpened?: boolean
  thresholdBefore?: number
  thresholdAfter?: number
  penaltyDelta?: number
}

interface DiffOptions {
  viewerId: string | null
  playerNames: Record<string, string>
}

function playerName(playerId: string | undefined, playerNames: Record<string, string>): string {
  if (!playerId) return 'Игрок'
  return playerNames[playerId] ?? playerId
}

function handSize(hand: Card[] | number | undefined): number {
  if (Array.isArray(hand)) return hand.length
  return hand ?? 0
}

function handCardIds(hand: Card[] | number | undefined): Set<string> {
  return new Set(Array.isArray(hand) ? hand.map((card) => card.id) : [])
}

function cardsInMeld(meld: Meld | undefined): Card[] {
  return meld?.slots.filter((card): card is Card => card !== null) ?? []
}

function describeMeld(meld: Meld): string {
  if (meld.kind === 'SET') return `комбинацию ${meld.rank_or_suit_anchor}`
  if (meld.kind === 'SEQUENCE') return 'последовательность'
  return 'козырную комбинацию'
}

function cardCountLabel(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return `${count} карту`
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) {
    return `${count} карты`
  }
  return `${count} карт`
}

function meldsById(melds: Record<string, Meld[]>): Map<string, Meld> {
  const byId = new Map<string, Meld>()
  for (const teamMelds of Object.values(melds)) {
    for (const meld of teamMelds) byId.set(meld.id, meld)
  }
  return byId
}

function newViewerCardIds(
  previous: GameStateData,
  next: GameStateData,
  viewerId: string | null,
): string[] {
  if (!viewerId) return []
  const previousHand = previous.hands[viewerId]
  const nextHand = next.hands[viewerId]
  if (!Array.isArray(nextHand)) return []
  const previousIds = handCardIds(previousHand)
  return nextHand.map((card) => card.id).filter((id) => !previousIds.has(id))
}

export function diffGameStates(
  previous: GameStateData | null,
  next: GameStateData,
  { viewerId, playerNames }: DiffOptions,
): { events: GameUiEvent[]; newCardIds: string[] } {
  if (previous === null) return { events: [], newCardIds: [] }

  const events: GameUiEvent[] = []
  const actorId = previous.turn_player_id
  const actor = playerName(actorId, playerNames)
  const newCardIds = newViewerCardIds(previous, next, viewerId)

  const previousActorHand = handSize(previous.hands[actorId])
  const nextActorHand = handSize(next.hands[actorId])
  if (nextActorHand > previousActorHand) {
    if (next.deck_count < previous.deck_count) {
      events.push({
        type: 'draw_deck',
        actorId,
        cardIds: actorId === viewerId ? newCardIds : undefined,
        text: actorId === viewerId ? 'Вы взяли карту из колоды' : `${actor} взял карту из колоды`,
      })
    } else if (next.discard_count < previous.discard_count) {
      events.push({
        type: 'draw_discard',
        actorId,
        cardIds: actorId === viewerId ? newCardIds : undefined,
        text: actorId === viewerId ? 'Вы взяли сброс' : `${actor} взял сброс`,
      })
    }
  }

  const previousDiscardTop = previous.discard_pile.at(-1)
  const nextDiscardTop = next.discard_pile.at(-1)
  if (
    nextDiscardTop !== undefined &&
    nextDiscardTop.id !== previousDiscardTop?.id &&
    next.discard_count >= previous.discard_count
  ) {
    events.push({
      type: 'discard',
      actorId,
      discardCardId: nextDiscardTop.id,
      text:
        actorId === viewerId
          ? `Вы сбросили ${cardLabel(nextDiscardTop)}`
          : `${actor} сбросил ${cardLabel(nextDiscardTop)}`,
    })
  }

  const previousMelds = meldsById(previous.melds)
  for (const [teamId, melds] of Object.entries(next.melds)) {
    for (const meld of melds) {
      const previousMeld = previousMelds.get(meld.id)
      const previousCards = cardsInMeld(previousMeld)
      const nextCards = cardsInMeld(meld)
      if (nextCards.length <= previousCards.length) continue

      const wasOpen = previousMeld === undefined || canastaStatus(previousMeld) === 'open'
      const isClosed = canastaStatus(meld) !== 'open'
      const addedCount = nextCards.length - previousCards.length
      if (wasOpen && isClosed) {
        events.push({
          type: 'canasta',
          actorId,
          teamId,
          cardIds: nextCards.slice(previousCards.length).map((card) => card.id),
          meldId: meld.id,
          text:
            actorId === viewerId
              ? 'Вы собрали канасту'
              : `${actor} собрал канасту для команды ${teamId}`,
        })
      } else {
        events.push({
          type: 'meld',
          actorId,
          teamId,
          cardIds: nextCards.slice(previousCards.length).map((card) => card.id),
          meldId: meld.id,
          text:
            previousMeld === undefined
              ? actorId === viewerId
                ? `Вы создали ${describeMeld(meld)}`
                : `${actor} создал ${describeMeld(meld)}`
              : actorId === viewerId
                ? `Вы добавили ${cardCountLabel(addedCount)} в ${describeMeld(meld)}`
                : `${actor} добавил ${cardCountLabel(addedCount)} в ${describeMeld(meld)}`,
        })
      }
    }
  }

  if (previous.turn_player_id !== next.turn_player_id) {
    const nextPlayer = playerName(next.turn_player_id, playerNames)
    events.push({
      type: 'turn',
      actorId: next.turn_player_id,
      text: next.turn_player_id === viewerId ? 'Ход перешёл к вам' : `Ход перешёл к ${nextPlayer}`,
    })
  }

  return { events, newCardIds }
}
