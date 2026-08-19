"""Drives bot turns automatically once it's their turn.

A bot has no real WebSocket -- instead, after anything that might hand the
turn to one (game start, any intent, a host force-skip), `router.py` calls
`maybe_schedule_bot_turn` with the session/game/game_state it already has in
hand. If the new current player is a bot, this schedules a background step
that waits a beat, decides one intent via the bot's strategy, and feeds it
through the exact same `_handle_intent` real WS messages go through -- which
itself calls `maybe_schedule_bot_turn` again at the end. That's the whole
loop: no explicit while-loop here, it's just recursion through the normal
intent-handling path, so multiple bots in a row (or a bot's own
draw-then-discard) chain automatically.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random

from sqlalchemy.ext.asyncio import AsyncSession

from app.bots.strategy import BOT_STRATEGIES, DEFAULT_BOT_STRATEGY
from app.config import settings
from app.db.models import Game, Player
from app.engine.engine import DealState, GameState
from app.engine.serialization import game_state_to_dict
from app.engine.turn_fsm import TurnPhase
from app.redis_store import RedisGameStore

# Cosmetic pause so a bot's turn doesn't feel instant -- randomized per move
# instead of a fixed beat so a bot's whole turn doesn't read as a metronome.
# Production keeps the original short pause. Development can override this
# through environment variables while the client has no between-deals pause.
BOT_MOVE_DELAY_RANGE_SECONDS = (
    settings.bot_move_delay_min_seconds,
    settings.bot_move_delay_max_seconds,
)

logger = logging.getLogger(__name__)

store = RedisGameStore()

# asyncio only keeps weak references to running tasks -- without an anchor a
# scheduled bot step can be garbage-collected mid-flight and silently vanish
_bot_tasks: set[asyncio.Task] = set()


async def maybe_schedule_bot_turn(
    session: AsyncSession, game: Game, game_state: GameState
) -> None:
    """Reuses the caller's already-open session for the cheap "is the next
    player a bot" check instead of opening a second one -- a real Postgres
    deployment tolerates concurrent sessions fine, but nesting one inside a
    still-open caller session trips up the in-memory SQLite used in tests."""
    if game_state.current_deal is None:
        return
    bot_id = game_state.current_deal.turn_state.current_player_id
    player = await session.get(Player, bot_id)
    if player is None or not player.is_bot:
        return

    task = asyncio.create_task(_play_bot_step(game.id, bot_id))
    _bot_tasks.add(task)
    task.add_done_callback(_bot_tasks.discard)


def _fallback_intent(deal: DealState, bot_id: str) -> tuple[str, dict]:
    """The dumbest always-legal move for the current phase, used when the
    strategy's choice was rejected by the engine."""
    turn = deal.turn_state
    if turn.phase == TurnPhase.DRAW:
        return "draw_deck", {}
    if (
        turn.must_meld_after_pickup
        and turn.melds_created_this_turn == 0
        and not turn.pending_penalty
    ):
        return "concede_penalty", {}
    hand = deal.hands[bot_id]
    if hand:
        return "discard", {"card_id": hand[0].id}
    return "concede_penalty", {}


async def _play_bot_step(game_id: str, bot_id: str) -> None:
    await asyncio.sleep(random.uniform(*BOT_MOVE_DELAY_RANGE_SECONDS))

    game_state = store.get_state(game_id)
    if game_state is None or game_state.current_deal is None:
        return
    if game_state.current_deal.turn_state.current_player_id != bot_id:
        return  # turn moved on (e.g. a host skip raced this step) -- nothing to do

    before = json.dumps(game_state_to_dict(game_state), sort_keys=True)

    strategy = BOT_STRATEGIES[DEFAULT_BOT_STRATEGY]
    try:
        intent, data = strategy.choose_intent(game_state.current_deal, bot_id)
    except Exception:
        logger.exception("bot %s strategy crashed, using fallback move", bot_id)
        intent, data = _fallback_intent(game_state.current_deal, bot_id)

    # Deferred import: router.py calls maybe_schedule_bot_turn, so importing
    # it at module load time here would be circular.
    from app.ws.router import _handle_intent

    await _handle_intent(game_id, bot_id, {"type": intent, "data": data})

    # A rejected intent only produces an action_error aimed at a socket the
    # bot doesn't have, and nothing reschedules the bot -- the game would
    # hang until a host skip. Detect "nothing changed" and push the turn
    # forward with the safe baseline move instead.
    after_state = store.get_state(game_id)
    if after_state is None or after_state.current_deal is None:
        return
    if after_state.current_deal.turn_state.current_player_id != bot_id:
        return
    after = json.dumps(game_state_to_dict(after_state), sort_keys=True)
    if after != before:
        return

    fallback = _fallback_intent(after_state.current_deal, bot_id)
    if fallback == (intent, data):
        logger.error(
            "bot %s made no progress with %r and has no fallback left; "
            "waiting for the host to skip its turn",
            bot_id,
            intent,
        )
        return
    logger.warning(
        "bot %s intent %r was rejected by the engine, falling back to %r",
        bot_id,
        intent,
        fallback[0],
    )
    await _handle_intent(game_id, bot_id, {"type": fallback[0], "data": fallback[1]})
