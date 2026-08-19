// Server -> client WS messages (plan section 8). The server is the single
// source of truth and always sends full snapshots, never deltas.

export interface LobbyPlayer {
  id: string
  name: string
  seat: number | null
  team_id: string | null
  connected: boolean
  is_host: boolean
  is_bot: boolean
}

export interface LobbyStateMessage {
  type: 'lobby_state'
  data: {
    players: LobbyPlayer[]
    settings: { target_score: number; discard_visibility: string }
    host_id: string
  }
}

export interface PlayerConnectionMessage {
  type: 'player_connection'
  data: { player_id: string; connected: boolean }
}

export interface ActionErrorMessage {
  type: 'action_error'
  data: { reason: string }
}

export interface Card {
  id: string
  rank: string
  suit: string | null
}

export type GameActionType =
  | 'draw_deck'
  | 'draw_discard'
  | 'create_meld'
  | 'add_to_meld'
  | 'steal_wild'
  | 'discard'
  | 'concede_penalty'
  | 'skip_turn_with_penalty'
  | 'rollback'

export interface GameActionData {
  action: GameActionType
  actor_id: string
  team_id: string
  phase_after: string
  turn_player_after: string
  meld_id: string | null
  cards: Card[]
  drawn_cards: Card[]
  draw_count: number
  discard_count_before: number
  team_opened: boolean
  threshold_before: number
  threshold_after: number
  penalty_delta: number
  canasta_completed: boolean
  deal_completed: boolean
  exit_type: string | null
  stolen_card_id?: string
  replacement_card_id?: string
}

export interface Meld {
  id: string
  team_id: string
  kind: string
  rank_or_suit_anchor: string
  slots: (Card | null)[]
}

// hands[playerId] is the viewer's own full hand, or another player's card
// count -- the server never sends other players' actual cards (NFR-3).
export interface GameStateData {
  hands: Record<string, Card[] | number>
  melds: Record<string, Meld[]>
  deck_count: number
  discard_pile: Card[]
  discard_count: number
  scores: Record<string, number>
  thresholds: Record<string, number>
  turn_player_id: string
  turn_phase: string
  // FR-22 turn-progress flags: whether the current player took the discard
  // pile (and so owes a new meld), how many melds they laid this turn, and
  // whether they already accepted the -1000 "не могу выложить" penalty.
  must_meld_after_pickup: boolean
  melds_created_this_turn: number
  pending_penalty: boolean
  team_opened: Record<string, boolean>
  turn_accumulator: Record<string, number>
  penalties?: Record<string, number>
  last_action?: GameActionData | null
}

export interface GameStateMessage {
  type: 'game_state'
  data: GameStateData
}

// mirrors DealScoreBreakdown (backend/app/engine/scoring.py)
export interface DealScoreBreakdown {
  table_points: number
  canasta_bonus: number
  hand_penalty: number
  three_bonus: number
  exit_bonus: number
  total: number
}

export interface DealResultMessage {
  type: 'deal_result'
  data: {
    deal_number: number
    scores_breakdown: Record<string, DealScoreBreakdown>
    team_scores_after: Record<string, number>
    next_deal: boolean
    transition_ends_at?: number | null
    last_action?: GameActionData | null
  }
}

export interface GameOverMessage {
  type: 'game_over'
  data: { winner_team: string }
}

export interface TurnTimerExpiredMessage {
  type: 'turn_timer_expired'
  data: { player_id: string }
}

export interface ChatMessageMessage {
  type: 'chat_message'
  data: { from: string; text: string; ts: string }
}

export interface OtherMessage {
  type: string
  data: unknown
}

export type ServerMessage =
  | LobbyStateMessage
  | PlayerConnectionMessage
  | ActionErrorMessage
  | GameStateMessage
  | DealResultMessage
  | GameOverMessage
  | TurnTimerExpiredMessage
  | ChatMessageMessage
  | OtherMessage

export function isLobbyStateMessage(
  message: ServerMessage,
): message is LobbyStateMessage {
  return message.type === 'lobby_state'
}

export function isGameStateMessage(
  message: ServerMessage,
): message is GameStateMessage {
  return message.type === 'game_state'
}

export function isDealResultMessage(
  message: ServerMessage,
): message is DealResultMessage {
  return message.type === 'deal_result'
}

export function isGameOverMessage(
  message: ServerMessage,
): message is GameOverMessage {
  return message.type === 'game_over'
}

export function isActionErrorMessage(
  message: ServerMessage,
): message is ActionErrorMessage {
  return message.type === 'action_error'
}

export function isPlayerConnectionMessage(
  message: ServerMessage,
): message is PlayerConnectionMessage {
  return message.type === 'player_connection'
}

export function isChatMessageMessage(
  message: ServerMessage,
): message is ChatMessageMessage {
  return message.type === 'chat_message'
}

export function isTurnTimerExpiredMessage(
  message: ServerMessage,
): message is TurnTimerExpiredMessage {
  return message.type === 'turn_timer_expired'
}
