from app.engine.models import Card, Rank, Suit
from app.engine.rules import build_new_meld
from app.redis_store import RedisGameStore


def _force_hand(
    redis_store: RedisGameStore, game_id: str, player_id: str, cards: list[Card]
) -> None:
    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    game_state.current_deal.hands[player_id] = cards
    redis_store.set_state(game_id, game_state)


def _force_opponent_meld(
    redis_store: RedisGameStore,
    game_id: str,
    team_id: str,
    meld_id: str,
    cards: list[Card],
) -> None:
    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    meld = build_new_meld(meld_id, team_id, cards)
    game_state.current_deal.teams[team_id].melds.append(meld)
    redis_store.set_state(game_id, game_state)


def test_steal_wild_with_correct_replacement_succeeds(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]
    assert turn_player_id == host_id  # host is seated first, so it starts

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    opp_cards = [
        Card(id="b_n1", rank=Rank.SEVEN, suit=Suit.CLUBS),
        Card(id="b_n2", rank=Rank.SEVEN, suit=Suit.SPADES),
        Card(id="b_w1", rank=Rank.TWO, suit=Suit.HEARTS),
    ]
    _force_opponent_meld(redis_store, game_id, "B", "opp-meld", opp_cards)
    _force_hand(
        redis_store,
        game_id,
        turn_player_id,
        [Card(id="rep1", rank=Rank.SEVEN, suit=Suit.DIAMONDS)],
    )

    sockets[turn_player_id].send_json(
        {
            "type": "steal_wild",
            "data": {
                "meld_id": "opp-meld",
                "wild_card_id": "b_w1",
                "replacement_card_id": "rep1",
            },
        }
    )
    states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for pid, state in states.items():
        assert state["type"] == "game_state"
        b_melds = state["data"]["melds"]["B"]
        assert len(b_melds) == 1
        slot_ids = [c["id"] if c else None for c in b_melds[0]["slots"]]
        assert "b_w1" not in slot_ids
        assert "rep1" in slot_ids
        assert state["data"]["last_action"]["action"] == "steal_wild"
        assert state["data"]["last_action"]["meld_id"] == "opp-meld"
        assert state["data"]["last_action"]["stolen_card_id"] == "b_w1"

        own_hand = state["data"]["hands"][turn_player_id]
        if pid == turn_player_id:
            assert [c["id"] for c in own_hand] == ["b_w1"]
        else:
            assert own_hand == 1


def test_steal_wild_with_wrong_replacement_is_rejected_and_state_unchanged(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    opp_cards = [
        Card(id="b_n1", rank=Rank.SEVEN, suit=Suit.CLUBS),
        Card(id="b_n2", rank=Rank.SEVEN, suit=Suit.SPADES),
        Card(id="b_w1", rank=Rank.TWO, suit=Suit.HEARTS),
    ]
    _force_opponent_meld(redis_store, game_id, "B", "opp-meld", opp_cards)
    _force_hand(
        redis_store,
        game_id,
        turn_player_id,
        [Card(id="wrong1", rank=Rank.EIGHT, suit=Suit.DIAMONDS)],
    )

    sockets[turn_player_id].send_json(
        {
            "type": "steal_wild",
            "data": {
                "meld_id": "opp-meld",
                "wild_card_id": "b_w1",
                "replacement_card_id": "wrong1",
            },
        }
    )
    error = sockets[turn_player_id].receive_json()
    assert error["type"] == "action_error"

    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    b_meld = next(
        m for m in game_state.current_deal.teams["B"].melds if m.id == "opp-meld"
    )
    assert {c.id for c in b_meld.slots if c is not None} == {"b_n1", "b_n2", "b_w1"}
    assert {c.id for c in game_state.current_deal.hands[turn_player_id]} == {"wrong1"}
