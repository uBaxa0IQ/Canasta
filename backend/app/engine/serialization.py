"""Pure (de)serialization of GameState <-> JSON-compatible dict (plan section 10).

Kept separate from redis_store.py so the engine package stays free of any
Redis/network dependency -- redis_store.py just calls to_dict/from_dict and
does the I/O.
"""

from __future__ import annotations

from app.engine.engine import (
    DealState,
    DealSummary,
    GameSettings,
    GameState,
    PlayerInfo,
)
from app.engine.models import Card, Meld, MeldKind, Rank, Suit, TeamTable
from app.engine.scoring import ExitType
from app.engine.turn_fsm import TurnPhase, TurnState


def _card_to_dict(card: Card) -> dict:
    return {
        "id": card.id,
        "rank": card.rank.value,
        "suit": card.suit.value if card.suit else None,
    }


def _card_from_dict(data: dict) -> Card:
    return Card(
        id=data["id"],
        rank=Rank(data["rank"]),
        suit=Suit(data["suit"]) if data["suit"] else None,
    )


def _cards_to_list(cards: list[Card | None]) -> list[dict | None]:
    return [_card_to_dict(c) if c is not None else None for c in cards]


def _cards_from_list(data: list[dict | None]) -> list[Card | None]:
    return [_card_from_dict(c) if c is not None else None for c in data]


def _meld_to_dict(meld: Meld) -> dict:
    return {
        "id": meld.id,
        "team_id": meld.team_id,
        "kind": meld.kind.value,
        "rank_or_suit_anchor": meld.rank_or_suit_anchor,
        "slots": _cards_to_list(meld.slots),
    }


def _meld_from_dict(data: dict) -> Meld:
    return Meld(
        id=data["id"],
        team_id=data["team_id"],
        kind=MeldKind(data["kind"]),
        rank_or_suit_anchor=data["rank_or_suit_anchor"],
        slots=_cards_from_list(data["slots"]),
    )


def _team_table_to_dict(team_table: TeamTable) -> dict:
    return {
        "team_id": team_table.team_id,
        "melds": [_meld_to_dict(m) for m in team_table.melds],
        "is_opened": team_table.is_opened,
        "turn_accumulator": team_table.turn_accumulator,
    }


def _team_table_from_dict(data: dict) -> TeamTable:
    return TeamTable(
        team_id=data["team_id"],
        melds=[_meld_from_dict(m) for m in data["melds"]],
        is_opened=data["is_opened"],
        turn_accumulator=data["turn_accumulator"],
    )


def _turn_state_to_dict(turn_state: TurnState) -> dict:
    return {
        "current_player_id": turn_state.current_player_id,
        "phase": turn_state.phase.value,
        "must_meld_after_pickup": turn_state.must_meld_after_pickup,
        "melds_created_this_turn": turn_state.melds_created_this_turn,
        "pending_penalty": turn_state.pending_penalty,
        "created_meld_ids": list(turn_state.created_meld_ids),
    }


def _turn_state_from_dict(data: dict) -> TurnState:
    return TurnState(
        current_player_id=data["current_player_id"],
        phase=TurnPhase(data["phase"]),
        must_meld_after_pickup=data["must_meld_after_pickup"],
        melds_created_this_turn=data["melds_created_this_turn"],
        pending_penalty=data["pending_penalty"],
        # .get: states persisted before this field existed have no key
        created_meld_ids=tuple(data.get("created_meld_ids", ())),
    )


def _deal_state_to_dict(deal: DealState) -> dict:
    return {
        "deck": _cards_to_list(deal.deck),
        "discard_pile": _cards_to_list(deal.discard_pile),
        "teams": {tid: _team_table_to_dict(t) for tid, t in deal.teams.items()},
        "hands": {pid: _cards_to_list(cards) for pid, cards in deal.hands.items()},
        "thresholds": deal.thresholds,
        "player_order": deal.player_order,
        "player_team": deal.player_team,
        "turn_state": _turn_state_to_dict(deal.turn_state),
        "penalties": deal.penalties,
        "deal_over": deal.deal_over,
        "exit_team_id": deal.exit_team_id,
        "exit_type": deal.exit_type.value if deal.exit_type else None,
    }


def _deal_state_from_dict(data: dict) -> DealState:
    return DealState(
        deck=_cards_from_list(data["deck"]),
        discard_pile=_cards_from_list(data["discard_pile"]),
        teams={tid: _team_table_from_dict(t) for tid, t in data["teams"].items()},
        hands={pid: _cards_from_list(cards) for pid, cards in data["hands"].items()},
        thresholds=data["thresholds"],
        player_order=data["player_order"],
        player_team=data["player_team"],
        turn_state=_turn_state_from_dict(data["turn_state"]),
        penalties=data["penalties"],
        deal_over=data["deal_over"],
        exit_team_id=data["exit_team_id"],
        exit_type=ExitType(data["exit_type"]) if data["exit_type"] else None,
    )


def _player_info_to_dict(player: PlayerInfo) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "session_token": player.session_token,
        "seat": player.seat,
        "team_id": player.team_id,
        "connected": player.connected,
    }


def _player_info_from_dict(data: dict) -> PlayerInfo:
    return PlayerInfo(
        id=data["id"],
        name=data["name"],
        session_token=data["session_token"],
        seat=data["seat"],
        team_id=data["team_id"],
        connected=data["connected"],
    )


def game_state_to_dict(game_state: GameState) -> dict:
    return {
        "game_id": game_state.game_id,
        "settings": {
            "target_score": game_state.settings.target_score,
            "discard_visibility": game_state.settings.discard_visibility,
        },
        "players": [_player_info_to_dict(p) for p in game_state.players],
        "scores": game_state.scores,
        "current_deal": _deal_state_to_dict(game_state.current_deal)
        if game_state.current_deal
        else None,
        "deal_history": [
            {
                "deal_number": d.deal_number,
                "score_breakdown": d.score_breakdown,
                "team_scores_after": d.team_scores_after,
            }
            for d in game_state.deal_history
        ],
        "between_deals_until": game_state.between_deals_until,
    }


def game_state_from_dict(data: dict) -> GameState:
    return GameState(
        game_id=data["game_id"],
        settings=GameSettings(**data["settings"]),
        players=[_player_info_from_dict(p) for p in data["players"]],
        scores=data["scores"],
        current_deal=_deal_state_from_dict(data["current_deal"])
        if data["current_deal"]
        else None,
        deal_history=[DealSummary(**d) for d in data["deal_history"]],
        between_deals_until=data.get("between_deals_until"),
    )
