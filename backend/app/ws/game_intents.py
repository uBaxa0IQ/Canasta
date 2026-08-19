"""In-deal WS intents (plan section 8, phase 4): draw/meld/steal/discard.

Dispatches onto the pure engine (apply_action) against the live GameState
kept in Redis, then -- if the action ended the deal -- scores it, persists
the Deal row, and either starts the next deal or finishes the game.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import time

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Deal as DealRow
from app.db.models import Game
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
from app.engine.engine import (
    DealSummary,
    GameState,
    apply_action,
    final_deal_scores,
)
from app.engine.models import Card
from app.engine.errors import IllegalActionError
from app.redis_store import RedisGameStore

GAME_INTENTS = frozenset(
    {
        "draw_deck",
        "draw_discard",
        "create_meld",
        "add_to_meld",
        "steal_wild",
        "discard",
        "concede_penalty",
    }
)

BETWEEN_DEALS_SECONDS = 10.0


@dataclass
class GameIntentResult:
    game_state: GameState
    deal_completed: bool
    deal_result_message: dict | None
    winner_team_id: str | None
    # player-facing explanation for an action that changed state in an
    # unexpected-but-legal way (e.g. below-threshold melds rolled back)
    notice: str | None = None
    action_event: dict | None = None


def _event_card(card: Card) -> dict:
    return {
        "id": card.id,
        "rank": card.rank.value,
        "suit": card.suit.value if card.suit else None,
    }


def _meld_cards_by_id(deal) -> dict[str, list[Card]]:
    return {
        meld.id: [card for card in meld.slots if card is not None]
        for team in deal.teams.values()
        for meld in team.melds
    }


def _build_action_event(
    *,
    intent: str,
    data: dict,
    sender_id: str,
    before_hand: list[Card],
    before_discard: list[Card],
    before_melds: dict[str, list[Card]],
    before_opened: dict[str, bool],
    before_accumulator: dict[str, int],
    before_penalties: dict[str, int],
    deal,
    notice: str | None,
) -> dict:
    team_id = deal.player_team[sender_id]
    after_hand = deal.hands[sender_id]
    after_hand_ids = {card.id for card in after_hand}
    before_hand_ids = {card.id for card in before_hand}
    after_melds = _meld_cards_by_id(deal)
    added_to_hand = [card for card in after_hand if card.id not in before_hand_ids]
    removed_from_hand = [card for card in before_hand if card.id not in after_hand_ids]
    meld_id = data.get("meld_id")
    if intent == "create_meld":
        meld_id = next((mid for mid in after_melds if mid not in before_melds), None)

    canasta_completed = False
    if meld_id and meld_id in after_melds:
        canasta_completed = (
            len(before_melds.get(meld_id, [])) < 7 <= len(after_melds[meld_id])
        )

    event = {
        "action": "rollback" if notice is not None else intent,
        "actor_id": sender_id,
        "team_id": team_id,
        "phase_after": deal.turn_state.phase.value,
        "turn_player_after": deal.turn_state.current_player_id,
        "meld_id": meld_id,
        "cards": [_event_card(card) for card in removed_from_hand],
        "drawn_cards": [_event_card(card) for card in added_to_hand],
        "draw_count": max(0, len(after_hand) - len(before_hand)),
        "discard_count_before": len(before_discard),
        "team_opened": not before_opened.get(team_id, False)
        and deal.teams[team_id].is_opened,
        "threshold_before": before_accumulator.get(team_id, 0),
        "threshold_after": deal.teams[team_id].turn_accumulator,
        "penalty_delta": deal.penalties.get(team_id, 0)
        - before_penalties.get(team_id, 0),
        "canasta_completed": canasta_completed,
        "deal_completed": deal.deal_over,
        "exit_type": deal.exit_type.value if deal.exit_type else None,
    }
    if intent == "steal_wild":
        event["stolen_card_id"] = data.get("wild_card_id")
        event["replacement_card_id"] = data.get("replacement_card_id")
    return event


def _wild_side(data: dict) -> str:
    side = data.get("wild_side", "low")
    if side not in ("low", "high"):
        raise IllegalActionError(f"wild_side must be 'low' or 'high', got {side!r}")
    return side


def _build_action(intent: str, data: dict) -> Action:
    if intent == "draw_deck":
        return DrawDeck()
    if intent == "draw_discard":
        return DrawDiscard()
    if intent == "create_meld":
        return CreateMeld(
            card_ids=list(data.get("card_ids", [])), wild_side=_wild_side(data)
        )
    if intent == "add_to_meld":
        return AddToMeld(
            meld_id=data.get("meld_id", ""),
            card_ids=list(data.get("card_ids", [])),
            wild_side=_wild_side(data),
        )
    if intent == "steal_wild":
        return StealWild(
            meld_id=data.get("meld_id", ""),
            wild_card_id=data.get("wild_card_id", ""),
            replacement_card_id=data.get("replacement_card_id", ""),
        )
    if intent == "discard":
        return Discard(card_id=data.get("card_id", ""))
    if intent == "concede_penalty":
        return ConcedePenalty()
    raise IllegalActionError(f"unknown intent {intent!r}")


async def _complete_deal(
    session: AsyncSession, game: Game, game_state: GameState
) -> tuple[dict, str | None]:
    deal = game_state.current_deal
    assert deal is not None

    breakdowns = final_deal_scores(deal)
    for team_id, breakdown in breakdowns.items():
        game_state.scores[team_id] = game_state.scores.get(team_id, 0) + breakdown.total

    deal_number = game.current_deal_number
    score_breakdown = {tid: asdict(b) for tid, b in breakdowns.items()}
    team_scores_after = dict(game_state.scores)

    session.add(
        DealRow(
            game_id=game.id,
            deal_number=deal_number,
            score_breakdown=score_breakdown,
            team_scores_after=team_scores_after,
        )
    )
    game_state.deal_history.append(
        DealSummary(
            deal_number=deal_number,
            score_breakdown=score_breakdown,
            team_scores_after=team_scores_after,
        )
    )

    winner_team_id = next(
        (
            tid
            for tid, score in team_scores_after.items()
            if score >= game_state.settings.target_score
        ),
        None,
    )

    if winner_team_id is not None:
        game.status = "FINISHED"
        game.winner_team_id = winner_team_id
        game.finished_at = datetime.now(timezone.utc)
        game_state.current_deal = None
        game_state.between_deals_until = None
    else:
        # Keep the completed deal in Redis during the visual table reset.
        # Its deal_over flag rejects every gameplay action. The router creates
        # and broadcasts the next deal only once this server deadline passes.
        game_state.between_deals_until = time.time() + BETWEEN_DEALS_SECONDS

    await session.commit()

    deal_result_message = {
        "type": "deal_result",
        "data": {
            "deal_number": deal_number,
            "scores_breakdown": score_breakdown,
            "team_scores_after": team_scores_after,
            "next_deal": winner_team_id is None,
            "transition_ends_at": game_state.between_deals_until,
        },
    }
    return deal_result_message, winner_team_id


async def apply_game_intent(
    store: RedisGameStore,
    session: AsyncSession,
    game: Game,
    sender_id: str,
    intent: str,
    data: dict,
) -> GameIntentResult:
    if game.status != "IN_PROGRESS":
        raise IllegalActionError("game is not in progress")

    action = _build_action(intent, data)

    with store.lock(game.id):
        game_state = store.get_state(game.id)
        if game_state is None or game_state.current_deal is None:
            raise IllegalActionError("no active deal")
        if game_state.between_deals_until is not None:
            raise IllegalActionError("next deal has not started yet")

        deal = game_state.current_deal
        before_hand = list(deal.hands[sender_id])
        before_discard = list(deal.discard_pile)
        before_melds = _meld_cards_by_id(deal)
        before_opened = {
            team_id: team.is_opened for team_id, team in deal.teams.items()
        }
        before_accumulator = {
            team_id: team.turn_accumulator for team_id, team in deal.teams.items()
        }
        before_penalties = dict(deal.penalties)

        apply_action(deal, sender_id, action)

        # one-shot notice: pop before persisting so it never reaches Redis
        notice = game_state.current_deal.pending_notice
        game_state.current_deal.pending_notice = None
        action_event = _build_action_event(
            intent=intent,
            data=data,
            sender_id=sender_id,
            before_hand=before_hand,
            before_discard=before_discard,
            before_melds=before_melds,
            before_opened=before_opened,
            before_accumulator=before_accumulator,
            before_penalties=before_penalties,
            deal=deal,
            notice=notice,
        )

        if not game_state.current_deal.deal_over:
            store.set_state(game.id, game_state)
            return GameIntentResult(
                game_state=game_state,
                deal_completed=False,
                deal_result_message=None,
                winner_team_id=None,
                notice=notice,
                action_event=action_event,
            )

        deal_result_message, winner_team_id = await _complete_deal(
            session, game, game_state
        )
        if game_state.current_deal is None:
            store.delete_state(game.id)
        else:
            store.set_state(game.id, game_state)

        return GameIntentResult(
            game_state=game_state,
            deal_completed=True,
            deal_result_message=deal_result_message,
            winner_team_id=winner_team_id,
            action_event=action_event,
        )
