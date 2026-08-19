"""Step 18 milestone: discard/concede_penalty, deal scoring, and advancing to
the next deal (or game_over), all driven purely through the WS protocol.

Getting an entire team from a fresh 13-card hand to a closed canasta would
need real bot AI, which is out of scope here -- these tests instead use the
Redis-backed DealState directly (same technique as the meld/steal tests) to
set up the *last* few moves deterministically, then drive the actual
discard/concede_penalty/scoring transition through the real WS intents.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import Deal as DealRow
from app.db.models import Game
from app.engine.models import Card, CanastaType, Rank, Suit
from app.engine.rules import build_new_meld
from app.redis_store import RedisGameStore


def _load(redis_store: RedisGameStore, game_id: str):
    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    assert game_state.current_deal is not None
    return game_state


def test_discard_passes_turn_to_next_player(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    player_ids = started_game["player_ids"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]
    assert turn_player_id == player_ids[0]

    game_state = _load(redis_store, game_id)
    game_state.current_deal.teams["A"].is_opened = True
    redis_store.set_state(game_id, game_state)

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    states = {pid: ws.receive_json() for pid, ws in sockets.items()}
    hand = states[turn_player_id]["data"]["hands"][turn_player_id]
    card_to_discard = hand[0]["id"]

    sockets[turn_player_id].send_json(
        {"type": "discard", "data": {"card_id": card_to_discard}}
    )
    states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for state in states.values():
        assert state["data"]["turn_player_id"] == player_ids[1]


def test_discard_auto_penalty_after_pickup_without_meld(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    game_state = _load(redis_store, game_id)
    game_state.current_deal.discard_pile = [
        Card(id="disc1", rank=Rank.FOUR, suit=Suit.SPADES)
    ]
    redis_store.set_state(game_id, game_state)

    sockets[turn_player_id].send_json({"type": "draw_discard", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    hand = _load(redis_store, game_id).current_deal.hands[turn_player_id]
    sockets[turn_player_id].send_json(
        {"type": "discard", "data": {"card_id": hand[0].id}}
    )
    for ws in sockets.values():
        ws.receive_json()

    game_state = _load(redis_store, game_id)
    assert game_state.current_deal.penalties["A"] == -1000


def test_concede_penalty_applies_1000_point_penalty(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    game_state = _load(redis_store, game_id)
    game_state.current_deal.discard_pile = [
        Card(id="disc1", rank=Rank.FOUR, suit=Suit.SPADES)
    ]
    redis_store.set_state(game_id, game_state)

    sockets[turn_player_id].send_json({"type": "draw_discard", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    sockets[turn_player_id].send_json({"type": "concede_penalty", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    game_state = _load(redis_store, game_id)
    assert game_state.current_deal.turn_state.pending_penalty is True
    assert game_state.current_deal.penalties["A"] == -1000


async def test_full_deal_flow_scores_and_advances_to_next_deal(
    started_game: dict,
    redis_store: RedisGameStore,
    db_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch,
) -> None:
    from app.ws import game_intents

    monkeypatch.setattr(game_intents, "BETWEEN_DEALS_SECONDS", 0.2)
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    player_ids = started_game["player_ids"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]
    assert turn_player_id == player_ids[0]
    team_a_partner_id = player_ids[2]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    # Team A already has a closed (7-card) canasta on the table and its
    # partner's hand is already empty -- host only needs to lay down one
    # more small meld to empty their own hand and trigger the clean exit
    # (FR-19: hand empty + team has a closed canasta -> auto go-out).
    closed_canasta = build_new_meld(
        "closed-1",
        "A",
        [
            Card(id=f"cc{i}", rank=Rank.EIGHT, suit=suit)
            for i, suit in enumerate(
                [Suit.CLUBS, Suit.SPADES, Suit.HEARTS, Suit.DIAMONDS, Suit.CLUBS]
            )
        ]
        + [
            Card(id="cc5", rank=Rank.EIGHT, suit=Suit.SPADES),
            Card(id="cc6", rank=Rank.EIGHT, suit=Suit.HEARTS),
        ],
    )
    assert closed_canasta.is_closed
    assert closed_canasta.canasta_type == CanastaType.CLEAN

    game_state = _load(redis_store, game_id)
    game_state.current_deal.teams["A"].melds = [closed_canasta]
    game_state.current_deal.teams["A"].is_opened = True
    game_state.current_deal.hands[team_a_partner_id] = []
    game_state.current_deal.hands[turn_player_id] = [
        Card(id="last1", rank=Rank.NINE, suit=Suit.CLUBS),
        Card(id="last2", rank=Rank.NINE, suit=Suit.SPADES),
        Card(id="last3", rank=Rank.NINE, suit=Suit.HEARTS),
    ]
    redis_store.set_state(game_id, game_state)

    sockets[turn_player_id].send_json(
        {
            "type": "create_meld",
            "data": {"card_ids": ["last1", "last2", "last3"]},
        }
    )
    responses = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for state in responses.values():
        assert state["type"] == "deal_result"
        assert state["data"]["deal_number"] == 1
        assert state["data"]["next_deal"] is True
        assert state["data"]["transition_ends_at"] is not None
        assert "A" in state["data"]["scores_breakdown"]
        assert "B" in state["data"]["scores_breakdown"]

    # The completed deal remains authoritative throughout the transition.
    transitioning = _load(redis_store, game_id)
    assert transitioning.current_deal is not None
    assert transitioning.current_deal.deal_over is True
    assert transitioning.between_deals_until is not None

    # Even the next player cannot act early; bots use the same intent path.
    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    blocked = sockets[turn_player_id].receive_json()
    assert blocked == {
        "type": "action_error",
        "data": {"reason": "next deal has not started yet"},
    }

    # A fresh deal is created and broadcast only after the server deadline.
    next_states = {pid: ws.receive_json() for pid, ws in sockets.items()}
    for pid, state in next_states.items():
        assert state["type"] == "game_state"
        own_hand = state["data"]["hands"][pid]
        assert isinstance(own_hand, list)
        assert len(own_hand) == 13
        assert state["data"]["melds"] == {"A": [], "B": []}
        # the opening turn rotates clockwise: deal 2 starts at seat 1
        assert state["data"]["turn_player_id"] == player_ids[1]

    async with db_session_factory() as session:
        game_row = await session.get(Game, game_id)
        assert game_row is not None
        assert game_row.status == "IN_PROGRESS"
        assert game_row.current_deal_number == 2

        deal_rows = (
            await session.scalars(select(DealRow).where(DealRow.game_id == game_id))
        ).all()
        assert len(deal_rows) == 1
        assert deal_rows[0].deal_number == 1
        assert (
            deal_rows[0].team_scores_after
            == responses[host_id]["data"]["team_scores_after"]
        )
