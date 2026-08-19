"""Shared WS test helpers: get a 4-player game from lobby all the way to
started (seats assigned, deal dealt) so gameplay-intent tests don't have to
re-derive the lobby dance every time.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.redis_store import RedisGameStore
from app.ws import game_intents, router


def create_game(client: TestClient, **overrides: object) -> dict:
    payload = {
        "host_name": "Alice",
        "target_score": 5000,
        "discard_visibility": "TOP_ONLY",
    }
    payload.update(overrides)
    response = client.post("/games", json=payload)
    assert response.status_code == 200
    return response.json()


def join_game(client: TestClient, game_id: str, name: str) -> dict:
    response = client.post(f"/games/{game_id}/join", json={"name": name})
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def started_game(
    client: TestClient, redis_store: RedisGameStore, monkeypatch: pytest.MonkeyPatch
) -> Iterator[dict]:
    # Production now randomizes who opens the very first deal; nearly every
    # test built on this fixture assumes the host goes first (it's simply
    # the first player seated below), so pin that back down here rather
    # than touching every individual test.
    monkeypatch.setattr(
        router, "_pick_first_player", lambda player_order: player_order[0]
    )
    # Keep integration tests fast while preserving the real delayed transition.
    monkeypatch.setattr(game_intents, "BETWEEN_DEALS_SECONDS", 0.05)

    game = create_game(client)
    game_id = game["game_id"]
    host_id = game["player_id"]
    tokens = {host_id: game["host_session_token"]}
    names = {host_id: "Alice"}

    for name in ["Bob", "Carol", "Dave"]:
        joined = join_game(client, game_id, name)
        tokens[joined["player_id"]] = joined["session_token"]
        names[joined["player_id"]] = name

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
                ws.receive_json()

        sockets[host_id].send_json({"type": "start_game", "data": {}})
        states = {pid: ws.receive_json() for pid, ws in sockets.items()}

        yield {
            "game_id": game_id,
            "host_id": host_id,
            "player_ids": player_ids,
            "sockets": sockets,
            "tokens": tokens,
            "names": names,
            "states": states,
            "client": client,
        }
