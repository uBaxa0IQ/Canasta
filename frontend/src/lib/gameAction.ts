import type { GameUiEvent } from './gameStateDiff'
import type { GameActionData } from './protocol'

export function gameActionToUiEvent(
  action: GameActionData,
  viewerId: string | null,
  playerNames: Record<string, string>,
): GameUiEvent {
  const actor = action.actor_id === viewerId ? 'Вы' : (playerNames[action.actor_id] ?? 'Игрок')
  const cardIds = action.cards.map((card) => card.id)
  const own = action.actor_id === viewerId
  const progress = {
    teamOpened: action.team_opened,
    thresholdBefore: action.threshold_before,
    thresholdAfter: action.threshold_after,
    penaltyDelta: action.penalty_delta,
  }

  if (action.action === 'draw_deck') {
    return { type: 'draw_deck', actorId: action.actor_id, cardIds: action.drawn_cards.map((card) => card.id), text: own ? 'Вы взяли карту из колоды' : `${actor} взял карту из колоды`, ...progress }
  }
  if (action.action === 'draw_discard') {
    return { type: 'draw_discard', actorId: action.actor_id, cardIds: action.drawn_cards.map((card) => card.id), text: own ? 'Вы взяли сброс' : `${actor} взял сброс`, ...progress }
  }
  if (action.action === 'discard') {
    return { type: 'discard', actorId: action.actor_id, discardCardId: cardIds[0], cardIds, text: own ? 'Вы сбросили карту' : `${actor} сбросил карту`, ...progress }
  }
  if (action.action === 'steal_wild') {
    return { type: 'steal_wild', actorId: action.actor_id, teamId: action.team_id, cardIds: [...cardIds, ...action.drawn_cards.map((card) => card.id)], meldId: action.meld_id ?? undefined, text: own ? 'Вы заменили козырь' : `${actor} заменил козырь`, ...progress }
  }
  if (action.action === 'rollback') {
    return { type: 'rollback', actorId: action.actor_id, teamId: action.team_id, text: 'Порог открытия не набран — карты вернулись в руку', ...progress }
  }
  if (action.action === 'concede_penalty' || action.action === 'skip_turn_with_penalty') {
    return { type: 'penalty', actorId: action.actor_id, teamId: action.team_id, text: `${actor} получил штраф`, ...progress }
  }
  return {
    type: action.canasta_completed ? 'canasta' : 'meld',
    actorId: action.actor_id,
    teamId: action.team_id,
    cardIds,
    meldId: action.meld_id ?? undefined,
    text: action.canasta_completed
      ? own ? 'Вы собрали канасту' : `${actor} собрал канасту`
      : own ? 'Вы выложили карты' : `${actor} выложил карты`,
    ...progress,
  }
}
