from app.engine.models import Card, Rank, Suit
from app.redis_store import RedisGameStore


def _force_hand(
    redis_store: RedisGameStore, game_id: str, player_id: str, cards: list[Card]
) -> None:
    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    assert game_state.current_deal is not None
    game_state.current_deal.hands[player_id] = cards
    redis_store.set_state(game_id, game_state)


def test_create_meld_with_valid_set_is_accepted(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    hand = [
        Card(id="t1", rank=Rank.SEVEN, suit=Suit.CLUBS),
        Card(id="t2", rank=Rank.SEVEN, suit=Suit.SPADES),
        Card(id="t3", rank=Rank.SEVEN, suit=Suit.HEARTS),
        Card(id="filler1", rank=Rank.FOUR, suit=Suit.DIAMONDS),
    ]
    _force_hand(redis_store, game_id, turn_player_id, hand)

    sockets[turn_player_id].send_json(
        {"type": "create_meld", "data": {"card_ids": ["t1", "t2", "t3"]}}
    )
    states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for pid, state in states.items():
        assert state["type"] == "game_state"
        melds = state["data"]["melds"]
        all_melds = [m for team_melds in melds.values() for m in team_melds]
        assert len(all_melds) == 1
        assert all_melds[0]["kind"] == "SET"
        assert all_melds[0]["rank_or_suit_anchor"] == Rank.SEVEN.value

        own_hand = state["data"]["hands"][turn_player_id]
        if pid == turn_player_id:
            assert isinstance(own_hand, list)
            assert len(own_hand) == 1
            assert own_hand[0]["id"] == "filler1"
        else:
            assert own_hand == 1


def test_melding_the_last_card_passes_turn_without_a_canasta(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    assert game_state.current_deal is not None
    next_player_id = game_state.current_deal.next_player(turn_player_id)
    _force_hand(
        redis_store,
        game_id,
        turn_player_id,
        [
            Card(id="a1", rank=Rank.ACE, suit=Suit.CLUBS),
            Card(id="a2", rank=Rank.ACE, suit=Suit.SPADES),
            Card(id="a3", rank=Rank.ACE, suit=Suit.HEARTS),
        ],
    )

    sockets[turn_player_id].send_json(
        {"type": "create_meld", "data": {"card_ids": ["a1", "a2", "a3"]}}
    )
    states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for pid, state in states.items():
        assert state["type"] == "game_state"
        assert state["data"]["turn_player_id"] == next_player_id
        assert state["data"]["turn_phase"] == "DRAW"
        assert state["data"]["hands"][turn_player_id] == (
            [] if pid == turn_player_id else 0
        )
        assert state["data"]["last_action"]["deal_completed"] is False


def test_create_meld_with_too_many_wilds_is_rejected_and_state_unchanged(
    started_game: dict, redis_store: RedisGameStore
) -> None:
    game_id = started_game["game_id"]
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    for ws in sockets.values():
        ws.receive_json()

    # exactly the case the user flagged: 1 natural + 2 wilds -- illegal
    # because wilds (2) would outnumber naturals (1) in the meld
    hand = [
        Card(id="n1", rank=Rank.SEVEN, suit=Suit.CLUBS),
        Card(id="w1", rank=Rank.TWO, suit=Suit.HEARTS),
        Card(id="w2", rank=Rank.JOKER, suit=None),
    ]
    _force_hand(redis_store, game_id, turn_player_id, hand)

    sockets[turn_player_id].send_json(
        {"type": "create_meld", "data": {"card_ids": ["n1", "w1", "w2"]}}
    )
    error = sockets[turn_player_id].receive_json()
    assert error["type"] == "action_error"

    game_state = redis_store.get_state(game_id)
    assert game_state is not None
    hand_ids = {c.id for c in game_state.current_deal.hands[turn_player_id]}
    assert hand_ids == {"n1", "w1", "w2"}
    all_melds = [
        m for team in game_state.current_deal.teams.values() for m in team.melds
    ]
    assert all_melds == []
