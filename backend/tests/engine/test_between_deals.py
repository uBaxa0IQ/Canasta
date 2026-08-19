from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
import time
from unittest.mock import AsyncMock

import pytest

from app.engine.engine import GameSettings, GameState, start_new_deal
from app.engine.errors import IllegalActionError
from app.engine.serialization import game_state_from_dict, game_state_to_dict
from app.ws import bot_runner, router
from app.ws.game_intents import apply_game_intent


def _transitioning_state(deadline: float = 1234.5) -> GameState:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    deal = start_new_deal(player_order, player_team, {"A": 100, "B": 200})
    deal.deal_over = True
    return GameState(
        game_id="g1",
        settings=GameSettings(),
        players=[],
        scores={"A": 100, "B": 200},
        current_deal=deal,
        between_deals_until=deadline,
    )


class FakeStore:
    def __init__(self, state: GameState) -> None:
        self.state = state

    @contextmanager
    def lock(self, _game_id: str):
        yield

    def get_state(self, _game_id: str) -> GameState:
        return self.state

    def set_state(self, _game_id: str, state: GameState) -> None:
        self.state = state


def test_between_deals_deadline_survives_serialization() -> None:
    state = _transitioning_state()

    restored = game_state_from_dict(game_state_to_dict(state))

    assert restored.between_deals_until == 1234.5
    assert restored.current_deal is not None
    assert restored.current_deal.deal_over is True


def test_old_serialized_state_defaults_to_no_transition() -> None:
    payload = game_state_to_dict(_transitioning_state())
    payload.pop("between_deals_until")

    assert game_state_from_dict(payload).between_deals_until is None


@pytest.mark.asyncio
async def test_gameplay_intent_is_rejected_during_transition() -> None:
    store = FakeStore(_transitioning_state())
    game = SimpleNamespace(id="g1", status="IN_PROGRESS")

    with pytest.raises(IllegalActionError, match="next deal has not started yet"):
        await apply_game_intent(store, None, game, "p1", "draw_deck", {})


@pytest.mark.asyncio
async def test_next_deal_and_bots_start_only_after_transition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deadline = time.time() - 0.01
    store = FakeStore(_transitioning_state(deadline))
    game = SimpleNamespace(id="g1", status="IN_PROGRESS", current_deal_number=1)
    players = [
        SimpleNamespace(id="p1", team_id="A", seat=0),
        SimpleNamespace(id="p2", team_id="B", seat=1),
        SimpleNamespace(id="p3", team_id="A", seat=2),
        SimpleNamespace(id="p4", team_id="B", seat=3),
    ]

    class ScalarResult:
        def all(self):
            return players

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _model, _game_id):
            return game

        async def scalars(self, _query):
            return ScalarResult()

        async def commit(self):
            return None

    broadcast = AsyncMock()
    arm_timer = AsyncMock()
    schedule_bot = AsyncMock()
    monkeypatch.setattr(router, "async_session", lambda: FakeSession())
    monkeypatch.setattr(router, "store", store)
    monkeypatch.setattr(router.manager, "broadcast_personalized", broadcast)
    monkeypatch.setattr(router, "_maybe_arm_turn_timer", arm_timer)
    monkeypatch.setattr(bot_runner, "maybe_schedule_bot_turn", schedule_bot)

    assert schedule_bot.await_count == 0
    await router._start_next_deal_after_transition("g1", deadline)

    assert store.state.between_deals_until is None
    assert store.state.current_deal is not None
    assert store.state.current_deal.deal_over is False
    assert all(len(hand) == 13 for hand in store.state.current_deal.hands.values())
    assert store.state.current_deal.turn_state.current_player_id == "p2"
    assert game.current_deal_number == 2
    broadcast.assert_awaited_once()
    arm_timer.assert_awaited_once()
    schedule_bot.assert_awaited_once()
