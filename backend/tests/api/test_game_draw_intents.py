def test_draw_deck_grows_own_hand_but_masks_for_others(started_game: dict) -> None:
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})

    states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for pid, state in states.items():
        assert state["type"] == "game_state"
        own_hand = state["data"]["hands"][turn_player_id]
        if pid == turn_player_id:
            assert isinstance(own_hand, list)
            assert len(own_hand) == 14
            assert len(state["data"]["last_action"]["drawn_cards"]) == 1
        else:
            assert own_hand == 14
            assert state["data"]["last_action"]["drawn_cards"] == []
        assert state["data"]["last_action"]["action"] == "draw_deck"
        assert state["data"]["last_action"]["actor_id"] == turn_player_id
        assert state["data"]["deck_count"] == 108 - 13 * 4 - 1


def test_draw_discard_on_empty_pile_is_rejected(started_game: dict) -> None:
    host_id = started_game["host_id"]
    sockets = started_game["sockets"]
    turn_player_id = started_game["states"][host_id]["data"]["turn_player_id"]

    sockets[turn_player_id].send_json({"type": "draw_discard", "data": {}})
    error = sockets[turn_player_id].receive_json()

    assert error["type"] == "action_error"

    # nobody else got a broadcast, and the actor can still draw normally --
    # i.e. the rejected draw_discard left the turn state untouched
    sockets[turn_player_id].send_json({"type": "draw_deck", "data": {}})
    ok = sockets[turn_player_id].receive_json()
    assert ok["type"] == "game_state"
