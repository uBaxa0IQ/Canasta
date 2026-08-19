import contextlib

import pytest
from fastapi.testclient import TestClient

from app.redis_store import RedisGameStore
from app.ws import router


def _create_game(client: TestClient) -> dict:
    response = client.post(
        "/games",
        json={
            "host_name": "Alice",
            "target_score": 5000,
            "discard_visibility": "TOP_ONLY",
        },
    )
    assert response.status_code == 200
    return response.json()


def _join(client: TestClient, game_id: str, name: str) -> dict:
    response = client.post(f"/games/{game_id}/join", json={"name": name})
    assert response.status_code == 200
    return response.json()


def test_two_clients_see_each_other_in_lobby_state(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]
    host_token = game["host_session_token"]
    bob = _join(client, game_id, "Bob")

    with client.websocket_connect(f"/ws/games/{game_id}?token={host_token}") as host_ws:
        host_state = host_ws.receive_json()
        assert host_state["type"] == "lobby_state"
        # both rows already exist in the DB (Bob joined via REST before the
        # socket opened) -- lobby_state always reflects the full roster, not
        # just who currently has a live connection
        assert len(host_state["data"]["players"]) == 2

        with client.websocket_connect(
            f"/ws/games/{game_id}?token={bob['session_token']}"
        ) as bob_ws:
            host_state_2 = host_ws.receive_json()
            assert len(host_state_2["data"]["players"]) == 2

            bob_state = bob_ws.receive_json()
            assert len(bob_state["data"]["players"]) == 2
            names = {p["name"] for p in bob_state["data"]["players"]}
            assert names == {"Alice", "Bob"}
            connected = {
                p["name"]: p["connected"] for p in bob_state["data"]["players"]
            }
            assert connected == {"Alice": True, "Bob": True}


def test_connect_with_invalid_token_is_rejected(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]

    with contextlib.suppress(Exception):
        with client.websocket_connect(f"/ws/games/{game_id}?token=not-a-real-token"):
            raise AssertionError("connection should have been rejected")


def test_start_game_flow_sends_personalized_game_state(
    client: TestClient, redis_store: RedisGameStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # the very first deal's opener is randomized in production; pin it to
    # the host (first seated) since that's what this test asserts below
    monkeypatch.setattr(
        router, "_pick_first_player", lambda player_order: player_order[0]
    )

    game = _create_game(client)
    game_id = game["game_id"]
    host_id = game["player_id"]
    tokens = {host_id: game["host_session_token"]}

    for name in ["Bob", "Carol", "Dave"]:
        joined = _join(client, game_id, name)
        tokens[joined["player_id"]] = joined["session_token"]

    player_ids = list(tokens.keys())

    with contextlib.ExitStack() as stack:
        sockets: dict[str, object] = {}

        def _connect(pid: str) -> None:
            ws = stack.enter_context(
                client.websocket_connect(f"/ws/games/{game_id}?token={tokens[pid]}")
            )
            sockets[pid] = ws
            ws.receive_json()
            for other_pid, other_ws in sockets.items():
                if other_pid != pid:
                    other_ws.receive_json()

        for pid in player_ids:
            _connect(pid)

        for seat, pid in enumerate(player_ids):
            sockets[host_id].send_json(
                {"type": "assign_seat", "data": {"player_id": pid, "seat": seat}}
            )
            for ws in sockets.values():
                msg = ws.receive_json()
                assert msg["type"] == "lobby_state"

        sockets[host_id].send_json({"type": "start_game", "data": {}})
        states = {pid: ws.receive_json() for pid, ws in sockets.items()}

    for pid, state in states.items():
        assert state["type"] == "game_state"
        data = state["data"]
        own_hand = data["hands"][pid]
        assert isinstance(own_hand, list)
        assert len(own_hand) == 13
        for other_pid, hand in data["hands"].items():
            if other_pid != pid:
                assert hand == 13
        assert data["deck_count"] == 108 - 13 * 4
        assert data["scores"] == {"A": 0, "B": 0}
        assert data["turn_player_id"] == host_id


def test_host_can_swap_occupied_seats(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]
    host_id = game["player_id"]
    bob = _join(client, game_id, "Bob")

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={game['host_session_token']}"
    ) as host_ws:
        host_ws.receive_json()

        host_ws.send_json(
            {"type": "assign_seat", "data": {"player_id": host_id, "seat": 0}}
        )
        host_ws.receive_json()
        host_ws.send_json(
            {"type": "assign_seat", "data": {"player_id": bob["player_id"], "seat": 1}}
        )
        host_ws.receive_json()

        host_ws.send_json(
            {"type": "assign_seat", "data": {"player_id": bob["player_id"], "seat": 0}}
        )
        state = host_ws.receive_json()

    seats = {p["id"]: p["seat"] for p in state["data"]["players"]}
    teams = {p["id"]: p["team_id"] for p in state["data"]["players"]}
    assert seats[bob["player_id"]] == 0
    assert seats[host_id] == 1
    assert teams[bob["player_id"]] == "A"
    assert teams[host_id] == "B"


def test_non_host_cannot_start_game(
    client: TestClient, redis_store: RedisGameStore
) -> None:
    game = _create_game(client)
    game_id = game["game_id"]
    bob = _join(client, game_id, "Bob")

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={bob['session_token']}"
    ) as bob_ws:
        bob_ws.receive_json()  # initial lobby_state
        bob_ws.send_json({"type": "start_game", "data": {}})
        error = bob_ws.receive_json()
        assert error["type"] == "action_error"


def test_host_can_remove_a_human_player(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]
    bob = _join(client, game_id, "Bob")

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={game['host_session_token']}"
    ) as host_ws:
        host_ws.receive_json()
        host_ws.send_json(
            {
                "type": "remove_player",
                "data": {"player_id": bob["player_id"]},
            }
        )
        host_state = host_ws.receive_json()

    assert [p["name"] for p in host_state["data"]["players"]] == ["Alice"]


def test_host_can_remove_a_bot(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={game['host_session_token']}"
    ) as host_ws:
        host_ws.receive_json()
        host_ws.send_json({"type": "add_bot", "data": {"seat": 1}})
        with_bot = host_ws.receive_json()
        bot = next(p for p in with_bot["data"]["players"] if p["is_bot"])

        host_ws.send_json({"type": "remove_player", "data": {"player_id": bot["id"]}})
        without_bot = host_ws.receive_json()

    assert all(not p["is_bot"] for p in without_bot["data"]["players"])


def test_non_host_cannot_remove_players(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]
    bob = _join(client, game_id, "Bob")

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={bob['session_token']}"
    ) as bob_ws:
        bob_ws.receive_json()
        bob_ws.send_json(
            {
                "type": "remove_player",
                "data": {"player_id": game["player_id"]},
            }
        )
        error = bob_ws.receive_json()

    assert error == {
        "type": "action_error",
        "data": {"reason": "only the host can remove players"},
    }


def test_host_cannot_remove_themselves(client: TestClient) -> None:
    game = _create_game(client)
    game_id = game["game_id"]

    with client.websocket_connect(
        f"/ws/games/{game_id}?token={game['host_session_token']}"
    ) as host_ws:
        host_ws.receive_json()
        host_ws.send_json(
            {
                "type": "remove_player",
                "data": {"player_id": game["player_id"]},
            }
        )
        error = host_ws.receive_json()

    assert error == {
        "type": "action_error",
        "data": {"reason": "the host cannot be removed"},
    }
