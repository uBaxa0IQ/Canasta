"""Client-facing (redacted) view builders for WS messages (plan section 8).

Distinct from engine/serialization.py, which is full-fidelity and only ever
used for Redis persistence -- it must never be sent to a client verbatim,
since it contains every player's hand.
"""

from __future__ import annotations

from app.engine.engine import GameState
from app.engine.models import Card, Meld


def _card_public(card: Card) -> dict:
    return {
        "id": card.id,
        "rank": card.rank.value,
        "suit": card.suit.value if card.suit else None,
    }


def _meld_public(meld: Meld) -> dict:
    return {
        "id": meld.id,
        "team_id": meld.team_id,
        "kind": meld.kind.value,
        "rank_or_suit_anchor": meld.rank_or_suit_anchor,
        "slots": [_card_public(c) if c is not None else None for c in meld.slots],
    }


def _action_event_public(action_event: dict | None, viewer_id: str) -> dict | None:
    if action_event is None:
        return None
    public = dict(action_event)
    if action_event.get("actor_id") != viewer_id and action_event.get("action") in {
        "draw_deck",
        "draw_discard",
    }:
        public["drawn_cards"] = []
    return public


def build_client_game_state(
    game_state: GameState, viewer_id: str, action_event: dict | None = None
) -> dict:
    deal = game_state.current_deal
    if deal is None:
        raise ValueError("no active deal")

    hands: dict[str, list[dict] | int] = {
        pid: [_card_public(c) for c in cards] if pid == viewer_id else len(cards)
        for pid, cards in deal.hands.items()
    }

    if game_state.settings.discard_visibility == "FULL":
        discard_pile = [_card_public(c) for c in deal.discard_pile]
    else:
        discard_pile = (
            [_card_public(deal.discard_pile[-1])] if deal.discard_pile else []
        )

    return {
        "type": "game_state",
        "data": {
            "hands": hands,
            "melds": {
                team_id: [_meld_public(m) for m in team.melds]
                for team_id, team in deal.teams.items()
            },
            "deck_count": len(deal.deck),
            "discard_pile": discard_pile,
            "scores": game_state.scores,
            "thresholds": deal.thresholds,
            "turn_player_id": deal.turn_state.current_player_id,
            "turn_phase": deal.turn_state.phase.value,
            # Turn-progress flags (FR-22): the client needs these to know
            # whether a discard is currently legal and whether the
            # "не могу выложить" penalty escape hatch applies.
            "must_meld_after_pickup": deal.turn_state.must_meld_after_pickup,
            "melds_created_this_turn": deal.turn_state.melds_created_this_turn,
            "pending_penalty": deal.turn_state.pending_penalty,
            "team_opened": {
                team_id: team.is_opened for team_id, team in deal.teams.items()
            },
            "discard_count": len(deal.discard_pile),
            "turn_accumulator": {
                team_id: team.turn_accumulator for team_id, team in deal.teams.items()
            },
            "penalties": dict(deal.penalties),
            "last_action": _action_event_public(action_event, viewer_id),
        },
    }


def build_lobby_state(
    *,
    players: list[dict],
    target_score: int,
    discard_visibility: str,
    host_id: str,
) -> dict:
    return {
        "type": "lobby_state",
        "data": {
            "players": players,
            "settings": {
                "target_score": target_score,
                "discard_visibility": discard_visibility,
            },
            "host_id": host_id,
        },
    }
