"""apply_action: single entry point orchestrating the whole engine for one deal."""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field, replace

from app.engine.actions import (
    Action,
    AddToMeld,
    ConcedePenalty,
    CreateMeld,
    Discard,
    DrawDeck,
    DrawDiscard,
    StealWild,
)
from app.engine.errors import IllegalActionError
from app.engine.models import Card, Meld, TeamTable, generate_deck, opening_threshold
from app.engine.rules import add_to_meld as rules_add_to_meld
from app.engine.rules import build_new_meld, steal_wild as rules_steal_wild
from app.engine.scoring import DealScoreBreakdown, ExitType, score_deal
from app.engine.turn_fsm import (
    CONCEDE_PENALTY_POINTS,
    TurnPhase,
    TurnState,
    concede_penalty as fsm_concede_penalty,
    discard as fsm_discard,
    draw_from_deck,
    draw_from_discard,
    end_turn,
    force_skip as fsm_force_skip,
    go_out_clean,
    record_meld_created,
    start_turn,
    discard_incurring_penalty,
)

HAND_SIZE = 13
_meld_id_counter = itertools.count(1)

# pending_notice value: the discard was rejected and this turn's melds were
# returned to the hand because the opening threshold wasn't covered
OPENING_THRESHOLD_NOTICE = "opening threshold not met - melds returned to hand"


@dataclass
class DealState:
    deck: list[Card]
    discard_pile: list[Card]
    teams: dict[str, TeamTable]
    hands: dict[str, list[Card]]
    thresholds: dict[str, int]
    player_order: list[str]
    player_team: dict[str, str]
    turn_state: TurnState
    penalties: dict[str, int] = field(default_factory=dict)
    deal_over: bool = False
    exit_team_id: str | None = None
    exit_type: ExitType | None = None
    # transient, one-shot: set by apply_action when an action "succeeded" but
    # needs a player-facing explanation (e.g. melds rolled back); the WS layer
    # pops it before persisting, so it never reaches Redis
    pending_notice: str | None = None

    def team_of(self, player_id: str) -> TeamTable:
        return self.teams[self.player_team[player_id]]

    def next_player(self, player_id: str) -> str:
        idx = self.player_order.index(player_id)
        return self.player_order[(idx + 1) % len(self.player_order)]


@dataclass
class PlayerInfo:
    id: str
    name: str
    session_token: str
    seat: int | None = None
    team_id: str | None = None
    connected: bool = True


@dataclass
class GameSettings:
    target_score: int = 5000
    discard_visibility: str = "TOP_ONLY"  # "FULL" | "TOP_ONLY"


@dataclass
class DealSummary:
    deal_number: int
    score_breakdown: dict[str, int]
    team_scores_after: dict[str, int]


@dataclass
class GameState:
    """The whole match (plan section 9). `current_deal` is the only piece
    that changes on every action; it lives in Redis wholesale (section 10)."""

    game_id: str
    settings: GameSettings
    players: list[PlayerInfo]
    scores: dict[str, int]
    current_deal: DealState | None = None
    deal_history: list[DealSummary] = field(default_factory=list)
    # Unix timestamp until which a completed deal remains on the table.
    # While set, no new deal exists and all gameplay intents are rejected.
    between_deals_until: float | None = None


def start_new_deal(
    player_order: list[str],
    player_team: dict[str, str],
    team_scores: dict[str, int],
    *,
    rng: random.Random | None = None,
    first_player_id: str | None = None,
) -> DealState:
    """Deal 13 cards to each player from a freshly shuffled 108-card deck.

    `first_player_id` rotates the opening turn between deals (rules.md
    section 5: the deal passes clockwise); defaults to the first seat.
    """
    deck = generate_deck()
    (rng or random).shuffle(deck)

    hands: dict[str, list[Card]] = {p: [] for p in player_order}
    for _ in range(HAND_SIZE):
        for player_id in player_order:
            hands[player_id].append(deck.pop())

    team_ids = set(player_team.values())
    teams = {team_id: TeamTable(team_id=team_id) for team_id in team_ids}
    thresholds = {
        team_id: opening_threshold(team_scores.get(team_id, 0)) for team_id in team_ids
    }

    if first_player_id is not None and first_player_id not in player_order:
        raise ValueError(f"first_player_id {first_player_id!r} is not in player_order")

    return DealState(
        deck=deck,
        discard_pile=[],
        teams=teams,
        hands=hands,
        thresholds=thresholds,
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn(first_player_id or player_order[0]),
    )


def _require_current_player(deal: DealState, player_id: str) -> None:
    if deal.deal_over:
        raise IllegalActionError("deal is already over")
    if deal.turn_state.current_player_id != player_id:
        raise IllegalActionError(f"it is not {player_id}'s turn")


def _take_from_hand(hand: list[Card], card_ids: list[str]) -> list[Card]:
    by_id = {c.id: c for c in hand}
    missing = [cid for cid in card_ids if cid not in by_id]
    if missing:
        raise IllegalActionError(f"cards not in hand: {missing}")
    taken = [by_id[cid] for cid in card_ids]
    remaining_ids = set(card_ids)
    hand[:] = [c for c in hand if c.id not in remaining_ids]
    return taken


def _team_has_closed_canasta(team_table: TeamTable) -> bool:
    return any(meld.is_closed for meld in team_table.melds)


def _has_no_playable_cards(hand: list[Card]) -> bool:
    return all(card.is_three for card in hand)


def _maybe_open_team(team_table: TeamTable, threshold: int) -> None:
    if not team_table.is_opened and team_table.turn_accumulator >= threshold:
        team_table.is_opened = True


def _opening_value(meld: Meld) -> int:
    return meld.point_value + meld.canasta_bonus


def _rollback_created_melds(
    deal: DealState, player_id: str, team_table: TeamTable
) -> None:
    """Return this turn's freshly created melds (with everything added to
    them) to the acting player's hand -- used when an unopened team tries to
    end the turn below the opening threshold (rules.md section 10)."""
    created = set(deal.turn_state.created_meld_ids)
    kept: list[Meld] = []
    for meld in team_table.melds:
        if meld.id in created:
            deal.hands[player_id].extend(c for c in meld.slots if c is not None)
        else:
            kept.append(meld)
    team_table.melds = kept
    team_table.turn_accumulator = 0
    deal.turn_state = replace(
        deal.turn_state, melds_created_this_turn=0, created_meld_ids=()
    )


def _maybe_auto_clean_exit(deal: DealState, player_id: str) -> None:
    """After a meld action empties the hand with a closed canasta, go out (FR-19)."""
    team_table = deal.team_of(player_id)
    if not _has_no_playable_cards(
        deal.hands[player_id]
    ) or not _team_has_closed_canasta(team_table):
        return
    deal.turn_state = go_out_clean(
        deal.turn_state, hand_empty=True, team_has_closed_canasta=True
    )
    deal.deal_over = True
    deal.exit_team_id = deal.player_team[player_id]
    deal.exit_type = ExitType.CLEAN


def _maybe_advance_empty_hand_after_meld(deal: DealState, player_id: str) -> None:
    """A meld can consume the last card without ending the deal.

    A completed canasta still produces the regular clean exit. Without one,
    an actually empty hand simply ends this turn and the player will draw as
    normal when their next turn comes around.
    """
    _maybe_auto_clean_exit(deal, player_id)
    if deal.deal_over or deal.hands[player_id]:
        return

    team_id = deal.player_team[player_id]
    team_table = deal.teams[team_id]
    threshold = deal.thresholds[team_id]
    if not team_table.is_opened:
        # Emptying the hand does not make a below-threshold opening legal.
        _rollback_created_melds(deal, player_id, team_table)
        deal.pending_notice = OPENING_THRESHOLD_NOTICE
        return

    if discard_incurring_penalty(
        deal.turn_state,
        team_opened=team_table.is_opened,
        threshold_met=team_table.turn_accumulator >= threshold,
    ):
        deal.penalties[team_id] = (
            deal.penalties.get(team_id, 0) - CONCEDE_PENALTY_POINTS
        )

    deal.turn_state = start_turn(deal.next_player(player_id))


def apply_action(deal: DealState, player_id: str, action: Action) -> DealState:
    _require_current_player(deal, player_id)

    match action:
        case DrawDeck():
            if not deal.deck:
                deal.turn_state = replace(deal.turn_state, phase=TurnPhase.DEAL_END)
                deal.deal_over = True
                deal.exit_team_id = None
                deal.exit_type = None
                return deal
            deal.turn_state = draw_from_deck(deal.turn_state)
            deal.hands[player_id].append(deal.deck.pop())

        case DrawDiscard():
            if not deal.discard_pile:
                raise IllegalActionError("discard pile is empty")
            top = deal.discard_pile[-1]
            deal.turn_state = draw_from_discard(deal.turn_state, top)
            deal.hands[player_id].extend(deal.discard_pile)
            deal.discard_pile = []

        case CreateMeld(card_ids=card_ids, wild_side=wild_side):
            hand = deal.hands[player_id]
            cards = _take_from_hand(hand, card_ids)
            team_id = deal.player_team[player_id]
            try:
                meld = build_new_meld(
                    f"m{next(_meld_id_counter)}", team_id, cards, wild_side=wild_side
                )
            except IllegalActionError:
                hand.extend(cards)
                raise
            team_table = deal.teams[team_id]
            team_table.melds.append(meld)
            if not team_table.is_opened:
                team_table.turn_accumulator += _opening_value(meld)
                _maybe_open_team(team_table, deal.thresholds[team_id])
            deal.turn_state = record_meld_created(deal.turn_state, meld.id)
            _maybe_advance_empty_hand_after_meld(deal, player_id)

        case AddToMeld(meld_id=meld_id, card_ids=card_ids, wild_side=wild_side):
            hand = deal.hands[player_id]
            cards = _take_from_hand(hand, card_ids)
            team_id = deal.player_team[player_id]
            team_table = deal.teams[team_id]
            meld_idx = next(
                (i for i, m in enumerate(team_table.melds) if m.id == meld_id), None
            )
            if meld_idx is None:
                hand.extend(cards)
                raise IllegalActionError(f"no such meld {meld_id} for this team")
            old_meld = team_table.melds[meld_idx]
            try:
                new_meld = rules_add_to_meld(
                    old_meld, team_id, cards, wild_side=wild_side
                )
            except IllegalActionError:
                hand.extend(cards)
                raise
            team_table.melds[meld_idx] = new_meld
            if not team_table.is_opened:
                added_value = _opening_value(new_meld) - _opening_value(old_meld)
                team_table.turn_accumulator += added_value
                _maybe_open_team(team_table, deal.thresholds[team_id])
            _maybe_advance_empty_hand_after_meld(deal, player_id)

        case StealWild(
            meld_id=meld_id,
            wild_card_id=wild_card_id,
            replacement_card_id=replacement_card_id,
        ):
            hand = deal.hands[player_id]
            [replacement_card] = _take_from_hand(hand, [replacement_card_id])
            own_team_id = deal.player_team[player_id]
            opponent_meld = None
            opponent_team = None
            for team_id, team_table in deal.teams.items():
                if team_id == own_team_id:
                    continue
                for i, m in enumerate(team_table.melds):
                    if m.id == meld_id:
                        opponent_meld = (i, m)
                        opponent_team = team_table
                        break
            if opponent_meld is None or opponent_team is None:
                hand.append(replacement_card)
                raise IllegalActionError(f"no such opponent meld {meld_id}")
            idx, meld = opponent_meld
            try:
                new_meld, stolen = rules_steal_wild(
                    meld,
                    stealing_team_id=own_team_id,
                    wild_card_id=wild_card_id,
                    replacement_card=replacement_card,
                )
            except IllegalActionError:
                hand.append(replacement_card)
                raise
            opponent_team.melds[idx] = new_meld
            hand.append(stolen)

        case Discard(card_id=card_id):
            hand = deal.hands[player_id]
            [card] = _take_from_hand(hand, [card_id])
            team_table = deal.team_of(player_id)
            team_id = deal.player_team[player_id]
            threshold = deal.thresholds[team_id]

            if (
                not team_table.is_opened
                and deal.turn_state.melds_created_this_turn > 0
                and team_table.turn_accumulator < threshold
            ):
                # rules.md section 10: the opening must be fully covered
                # within one turn. Instead of ending the turn with illegal
                # melds on the table, reject the discard, hand this turn's
                # melds back and let the player redo the turn.
                hand.append(card)
                _rollback_created_melds(deal, player_id, team_table)
                deal.pending_notice = OPENING_THRESHOLD_NOTICE
                return deal

            threshold_met = team_table.turn_accumulator >= threshold
            if discard_incurring_penalty(
                deal.turn_state,
                team_opened=team_table.is_opened,
                threshold_met=threshold_met,
            ):
                deal.penalties[team_id] = (
                    deal.penalties.get(team_id, 0) - CONCEDE_PENALTY_POINTS
                )
                deal.turn_state = replace(deal.turn_state, pending_penalty=True)
            hand_empty_after = _has_no_playable_cards(hand)
            has_closed_canasta = _team_has_closed_canasta(team_table)
            try:
                deal.turn_state = fsm_discard(
                    deal.turn_state,
                    team_opened=team_table.is_opened,
                    threshold_met=threshold_met,
                    hand_empty_after=hand_empty_after,
                    team_has_closed_canasta=has_closed_canasta,
                )
            except IllegalActionError:
                hand.append(card)
                raise
            deal.discard_pile.append(card)
            if not team_table.is_opened:
                # rules.md section 10: the opening threshold must be covered
                # within a single turn -- meld points laid this turn never
                # carry over to help a later opening attempt.
                team_table.turn_accumulator = 0
            if deal.turn_state.phase == TurnPhase.DEAL_END:
                deal.deal_over = True
                deal.exit_team_id = deal.player_team[player_id]
                deal.exit_type = ExitType.DIRTY
            else:
                next_player = deal.next_player(player_id)
                deal.turn_state = end_turn(deal.turn_state, next_player)

        case ConcedePenalty():
            deal.turn_state = fsm_concede_penalty(deal.turn_state)
            team_id = deal.player_team[player_id]
            deal.penalties[team_id] = (
                deal.penalties.get(team_id, 0) - CONCEDE_PENALTY_POINTS
            )

        case _:
            raise IllegalActionError(f"unknown action {action!r}")

    return deal


def force_skip_turn(deal: DealState, target_player_id: str) -> DealState:
    """FR-37: host's administrative "skip with penalty" after a disconnect
    timeout. Unlike `apply_action`, the caller (host) is never the acting
    player, so this bypasses `_require_current_player` and instead checks
    that `target_player_id` really is the one holding up the turn. The
    stuck player's hand is left untouched -- only the penalty and the turn
    pointer move.
    """
    if deal.deal_over:
        raise IllegalActionError("deal is already over")
    if deal.turn_state.current_player_id != target_player_id:
        raise IllegalActionError(f"{target_player_id} is not the current player")

    team_id = deal.player_team[target_player_id]
    deal.penalties[team_id] = deal.penalties.get(team_id, 0) - CONCEDE_PENALTY_POINTS
    team_table = deal.teams[team_id]
    if not team_table.is_opened:
        team_table.turn_accumulator = 0
    next_player = deal.next_player(target_player_id)
    deal.turn_state = fsm_force_skip(deal.turn_state, next_player)
    return deal


def combined_team_hand(deal: DealState, team_id: str) -> list[Card]:
    return [
        card
        for player_id, cards in deal.hands.items()
        if deal.player_team[player_id] == team_id
        for card in cards
    ]


def final_deal_scores(deal: DealState) -> dict[str, DealScoreBreakdown]:
    if not deal.deal_over:
        raise IllegalActionError("deal is not over yet")
    team_hands = {team_id: combined_team_hand(deal, team_id) for team_id in deal.teams}
    results = score_deal(
        deal.teams,
        team_hands,
        went_out_team_id=deal.exit_team_id,
        exit_type=deal.exit_type,
    )
    for team_id, penalty in deal.penalties.items():
        breakdown = results[team_id]
        results[team_id] = DealScoreBreakdown(
            table_points=breakdown.table_points,
            canasta_bonus=breakdown.canasta_bonus,
            hand_penalty=breakdown.hand_penalty,
            three_bonus=breakdown.three_bonus,
            exit_bonus=breakdown.exit_bonus,
            total=breakdown.total + penalty,
        )
    return results
