import type { GameStateData } from './protocol'

export interface GameUiModel {
  isMyTurn: boolean
  phase: string
  canDrawDeck: boolean
  canTakeDiscard: boolean
  discardBlockedReason: string | null
  canCreateMeld: boolean
  canDiscard: boolean
  dragActEnabled: boolean
  dragDrawEnabled: boolean
  canAddToMelds: boolean
  pickupSatisfied: boolean
  viewerTeamOpened: boolean
  viewerThresholdMet: boolean
}

interface BuildGameUiModelInput {
  gameState: GameStateData
  isMyTurn: boolean
  gameOver: boolean
  viewerTeamId: string | null
  selectedCardCount: number
}

export function buildGameUiModel({
  gameState,
  isMyTurn,
  gameOver,
  viewerTeamId,
  selectedCardCount,
}: BuildGameUiModelInput): GameUiModel {
  const phase = gameState.turn_phase
  const viewerTeamOpened = viewerTeamId !== null && (gameState.team_opened[viewerTeamId] ?? false)
  const viewerThresholdMet =
    viewerTeamId !== null &&
    gameState.turn_accumulator[viewerTeamId] >= gameState.thresholds[viewerTeamId]

  const pickupSatisfied = !gameState.must_meld_after_pickup || gameState.melds_created_this_turn > 0

  const topDiscard = gameState.discard_pile[gameState.discard_pile.length - 1]
  const discardBlockedReason =
    gameState.discard_count === 0
      ? 'Стопка сброса пуста'
      : topDiscard?.rank === '3'
        ? 'Нельзя брать сброс, когда сверху лежит тройка'
        : null

  const canDrawDeck = isMyTurn && !gameOver && phase === 'DRAW' && gameState.deck_count > 0
  const canTakeDiscard = isMyTurn && !gameOver && phase === 'DRAW' && discardBlockedReason === null

  const dragActEnabled = isMyTurn && !gameOver && phase === 'ACT'
  const dragDrawEnabled = canTakeDiscard
  const canDiscard = dragActEnabled
  const canCreateMeld = dragActEnabled && selectedCardCount >= 3
  const canAddToMelds = dragActEnabled && selectedCardCount > 0

  return {
    isMyTurn,
    phase,
    canDrawDeck,
    canTakeDiscard,
    discardBlockedReason,
    canCreateMeld,
    canDiscard,
    dragActEnabled,
    dragDrawEnabled,
    canAddToMelds,
    pickupSatisfied,
    viewerTeamOpened,
    viewerThresholdMet,
  }
}
