"""WS handler: connect by session_token, dispatch lobby intents (plan section 8,
phase 3 scope only -- draw/meld/discard intents land in phase 4).
"""

from __future__ import annotations

import asyncio
import random
import secrets
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update

from app.db.models import ChatMessage, Game, Player
from app.db.session import async_session
from app.engine.engine import (
    GameSettings,
    GameState,
    PlayerInfo,
    force_skip_turn,
    start_new_deal,
)
from app.engine.errors import IllegalActionError
from app.redis_store import RedisGameStore
from app.ws import bot_runner, turn_timer
from app.ws.game_intents import GAME_INTENTS, apply_game_intent
from app.ws.manager import manager
from app.ws.serialization import build_client_game_state, build_lobby_state

router = APIRouter()

store = RedisGameStore()

SEATS = (0, 1, 2, 3)

# Strong references keep delayed next-deal tasks alive. A per-game slot also
# prevents reconnects from scheduling the same transition more than once.
_between_deal_tasks: dict[str, asyncio.Task] = {}


class LobbyActionError(Exception):
    pass


def _team_for_seat(seat: int) -> str:
    return "A" if seat % 2 == 0 else "B"


def _player_public(player: Player) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "seat": player.seat,
        "team_id": player.team_id,
        "connected": player.connected,
        "is_host": player.is_host,
        "is_bot": player.is_bot,
    }


def _player_connection_message(player_id: str, connected: bool) -> dict:
    return {
        "type": "player_connection",
        "data": {"player_id": player_id, "connected": connected},
    }


async def _lobby_state_message(session, game: Game) -> dict:
    players = (
        await session.scalars(select(Player).where(Player.game_id == game.id))
    ).all()
    host = next((p for p in players if p.is_host), None)
    return build_lobby_state(
        players=[_player_public(p) for p in players],
        target_score=game.target_score,
        discard_visibility=game.discard_visibility,
        host_id=host.id if host else "",
    )


def _pick_first_player(player_order: list[str]) -> str:
    """Broken out from _build_initial_game_state so tests can pin it down --
    without this, start_new_deal defaults to player_order[0] -- i.e. the
    game's very first turn always went to whoever sits in seat 0, which in
    practice is always the host. Later deals already rotate the opener
    (see game_intents.py); the first one should be just as random."""
    return random.choice(player_order)


def _build_initial_game_state(game: Game, players: list[Player]) -> GameState:
    seated = sorted(players, key=lambda p: p.seat)
    player_order = [p.id for p in seated]
    player_team = {p.id: p.team_id for p in seated}
    scores = {"A": 0, "B": 0}
    deal = start_new_deal(
        player_order,
        player_team,
        scores,
        first_player_id=_pick_first_player(player_order),
    )

    return GameState(
        game_id=game.id,
        settings=GameSettings(
            target_score=game.target_score,
            discard_visibility=game.discard_visibility,
        ),
        players=[
            PlayerInfo(
                id=p.id,
                name=p.name,
                session_token=p.session_token,
                seat=p.seat,
                team_id=p.team_id,
                connected=p.connected,
            )
            for p in seated
        ],
        scores=scores,
        current_deal=deal,
    )


async def _handle_assign_seat(session, game: Game, sender: Player, data: dict) -> None:
    if not sender.is_host:
        raise LobbyActionError("only the host can assign seats")
    if game.status != "LOBBY":
        raise LobbyActionError("game already started")

    seat = data.get("seat")
    player_id = data.get("player_id")
    if seat not in SEATS:
        raise LobbyActionError(f"invalid seat {seat!r}")

    target = await session.get(Player, player_id)
    if target is None or target.game_id != game.id:
        raise LobbyActionError(f"no such player {player_id!r}")

    others = (
        await session.scalars(
            select(Player).where(Player.game_id == game.id, Player.seat == seat)
        )
    ).all()
    displaced = next((p for p in others if p.id != target.id), None)
    previous_seat = target.seat

    target.seat = seat
    target.team_id = _team_for_seat(seat)
    if displaced is not None:
        displaced.seat = previous_seat
        displaced.team_id = (
            _team_for_seat(previous_seat) if previous_seat in SEATS else None
        )
    await session.commit()
    await manager.broadcast(game.id, await _lobby_state_message(session, game))


BOT_NAME_TEMPLATE = "Бот {seat}"

# Human-sounding nicknames instead of "Бот N" -- picked randomly per bot and
# kept unique within a game so two bots at the same table never collide.
BOT_NAME_POOL = [
    "Alex",
    "Jordan",
    "Sam",
    "Riley",
    "Casey",
    "Morgan",
    "Taylor",
    "Jamie",
    "Drew",
    "Quinn",
    "Avery",
    "Skyler",
    "Reese",
    "Cameron",
    "Dakota",
    "Rowan",
    "Blake",
    "Charlie",
    "Emerson",
    "Finley",
    "Harper",
    "Kendall",
    "Logan",
    "Parker",
    "Peyton",
    "Sawyer",
]


def _random_bot_name(taken: set[str]) -> str:
    available = [name for name in BOT_NAME_POOL if name not in taken]
    if available:
        return random.choice(available)
    return BOT_NAME_TEMPLATE.format(seat=len(taken) + 1)


async def _handle_add_bot(session, game: Game, sender: Player, data: dict) -> None:
    """Host fills an empty seat with a simple bot (see app/bots/strategy.py)
    instead of waiting for a real player to join -- same one-step seating as
    the initial deal, no separate 'join' step since nothing is joining."""
    if not sender.is_host:
        raise LobbyActionError("only the host can add a bot")
    if game.status != "LOBBY":
        raise LobbyActionError("game already started")

    seat = data.get("seat")
    if seat not in SEATS:
        raise LobbyActionError(f"invalid seat {seat!r}")

    others = (
        await session.scalars(
            select(Player).where(Player.game_id == game.id, Player.seat == seat)
        )
    ).all()
    if others:
        raise LobbyActionError(f"seat {seat} is already taken")

    taken_names = set(
        (
            await session.scalars(select(Player.name).where(Player.game_id == game.id))
        ).all()
    )

    bot = Player(
        game_id=game.id,
        name=_random_bot_name(taken_names),
        # never used to open a socket, but the column is unique + non-null
        session_token=secrets.token_urlsafe(24),
        seat=seat,
        team_id=_team_for_seat(seat),
        is_bot=True,
    )
    session.add(bot)
    await session.commit()
    await manager.broadcast(game.id, await _lobby_state_message(session, game))


async def _handle_remove_player(
    session, game: Game, sender: Player, data: dict
) -> None:
    if not sender.is_host:
        raise LobbyActionError("only the host can remove players")
    if game.status != "LOBBY":
        raise LobbyActionError("game already started")

    player_id = data.get("player_id")
    target = await session.get(Player, player_id)
    if target is None or target.game_id != game.id:
        raise LobbyActionError(f"no such player {player_id!r}")
    if target.is_host:
        raise LobbyActionError("the host cannot be removed")

    # Keep existing chat history while removing the participant row.
    await session.execute(
        update(ChatMessage)
        .where(ChatMessage.player_id == target.id)
        .values(player_id=None)
    )
    await session.delete(target)
    await session.commit()
    await manager.broadcast(game.id, await _lobby_state_message(session, game))


async def _handle_set_lobby_settings(
    session, game: Game, sender: Player, data: dict
) -> None:
    if not sender.is_host:
        raise LobbyActionError("only the host can change lobby settings")
    if game.status != "LOBBY":
        raise LobbyActionError("game already started")

    if "target_score" in data:
        game.target_score = int(data["target_score"])
    if "discard_visibility" in data:
        game.discard_visibility = data["discard_visibility"]
    await session.commit()
    await manager.broadcast(game.id, await _lobby_state_message(session, game))


async def _handle_send_chat(session, game: Game, sender: Player, data: dict) -> None:
    text = str(data.get("text", "")).strip()
    if not text:
        raise LobbyActionError("chat message must not be empty")
    if len(text) > 2000:
        raise LobbyActionError("chat message is too long")

    message = ChatMessage(game_id=game.id, player_id=sender.id, text=text)
    session.add(message)
    await session.commit()

    await manager.broadcast(
        game.id,
        {
            "type": "chat_message",
            "data": {
                "from": sender.id,
                "text": text,
                "ts": message.created_at.isoformat(),
            },
        },
    )


async def _handle_start_game(session, game: Game, sender: Player) -> None:
    if not sender.is_host:
        raise LobbyActionError("only the host can start the game")
    if game.status != "LOBBY":
        raise LobbyActionError("game already started")

    players = (
        await session.scalars(select(Player).where(Player.game_id == game.id))
    ).all()
    seats_taken = {p.seat for p in players}
    if len(players) != 4 or seats_taken != set(SEATS):
        raise LobbyActionError("all 4 seats must be filled before starting")

    game_state = _build_initial_game_state(game, list(players))
    store.set_state(game.id, game_state)

    game.status = "IN_PROGRESS"
    game.current_deal_number = 1
    await session.commit()

    await manager.broadcast_personalized(
        game.id, lambda pid: build_client_game_state(game_state, pid)
    )
    await bot_runner.maybe_schedule_bot_turn(session, game, game_state)


def _make_on_expire(game_id: str, player_id: str):
    async def _on_expire() -> None:
        await manager.broadcast(
            game_id,
            {"type": "turn_timer_expired", "data": {"player_id": player_id}},
        )

    return _on_expire


async def _maybe_arm_turn_timer(session, game: Game, game_state: GameState) -> None:
    """FR-35: if whoever's turn it now is happens to be disconnected --
    either they just dropped mid-turn, or the turn advanced to someone who
    was already offline -- start (or keep) the grace-period timer."""
    if game_state.between_deals_until is not None:
        return
    deal = game_state.current_deal
    if deal is None:
        return
    current_player_id = deal.turn_state.current_player_id
    player = await session.get(Player, current_player_id)
    if player is not None and not player.connected:
        turn_timer.arm(
            game.id, current_player_id, _make_on_expire(game.id, current_player_id)
        )


async def _start_next_deal_after_transition(
    game_id: str, transition_ends_at: float
) -> None:
    await asyncio.sleep(max(0.0, transition_ends_at - time.time()))

    async with async_session() as session:
        game = await session.get(Game, game_id)
        if game is None or game.status != "IN_PROGRESS":
            return

        with store.lock(game_id):
            game_state = store.get_state(game_id)
            if (
                game_state is None
                or game_state.current_deal is None
                or not game_state.current_deal.deal_over
                or game_state.between_deals_until != transition_ends_at
            ):
                return

            players = (
                await session.scalars(select(Player).where(Player.game_id == game_id))
            ).all()
            seated = sorted(players, key=lambda player: player.seat)
            player_order = [player.id for player in seated]
            player_team = {player.id: player.team_id for player in seated}
            first_player_id = player_order[game.current_deal_number % len(player_order)]
            game_state.current_deal = start_new_deal(
                player_order,
                player_team,
                game_state.scores,
                first_player_id=first_player_id,
            )
            game_state.between_deals_until = None
            game.current_deal_number += 1
            store.set_state(game_id, game_state)
            await session.commit()

        await manager.broadcast_personalized(
            game_id, lambda pid: build_client_game_state(game_state, pid)
        )
        await _maybe_arm_turn_timer(session, game, game_state)
        await bot_runner.maybe_schedule_bot_turn(session, game, game_state)


def _schedule_next_deal(game_id: str, transition_ends_at: float) -> None:
    existing = _between_deal_tasks.get(game_id)
    if existing is not None and not existing.done():
        return

    task = asyncio.create_task(
        _start_next_deal_after_transition(game_id, transition_ends_at)
    )
    _between_deal_tasks[game_id] = task

    def _discard(completed: asyncio.Task) -> None:
        if _between_deal_tasks.get(game_id) is completed:
            _between_deal_tasks.pop(game_id, None)

    task.add_done_callback(_discard)


async def _handle_skip_turn_with_penalty(session, game: Game, sender: Player) -> None:
    if not sender.is_host:
        raise LobbyActionError("only the host can skip a stuck player's turn")
    if game.status != "IN_PROGRESS":
        raise LobbyActionError("game is not in progress")

    with store.lock(game.id):
        game_state = store.get_state(game.id)
        if game_state is None or game_state.current_deal is None:
            raise LobbyActionError("no active deal")
        if game_state.between_deals_until is not None:
            raise LobbyActionError("next deal has not started yet")
        current_player_id = game_state.current_deal.turn_state.current_player_id
        skipped_team_id = game_state.current_deal.player_team[current_player_id]
        threshold_before = game_state.current_deal.teams[
            skipped_team_id
        ].turn_accumulator
        current_player = await session.get(Player, current_player_id)
        # A bot never disconnects, so its turn timer never arms -- if a bot
        # ever gets stuck (a strategy bug), the host still needs a way to
        # force the game forward without waiting for a timeout that will
        # never come.
        is_stuck_bot = current_player is not None and current_player.is_bot
        if not is_stuck_bot and turn_timer.expired_player(game.id) != current_player_id:
            raise LobbyActionError("turn timer has not expired for the current player")

        force_skip_turn(game_state.current_deal, current_player_id)
        action_event = {
            "action": "skip_turn_with_penalty",
            "actor_id": current_player_id,
            "team_id": skipped_team_id,
            "phase_after": game_state.current_deal.turn_state.phase.value,
            "turn_player_after": game_state.current_deal.turn_state.current_player_id,
            "meld_id": None,
            "cards": [],
            "drawn_cards": [],
            "draw_count": 0,
            "discard_count_before": len(game_state.current_deal.discard_pile),
            "team_opened": False,
            "threshold_before": threshold_before,
            "threshold_after": game_state.current_deal.teams[
                skipped_team_id
            ].turn_accumulator,
            "penalty_delta": -1000,
            "canasta_completed": False,
            "deal_completed": False,
            "exit_type": None,
        }
        store.set_state(game.id, game_state)

    turn_timer.cancel_for_player(game.id, current_player_id)
    await manager.broadcast_personalized(
        game.id,
        lambda pid: build_client_game_state(game_state, pid, action_event),
    )
    await _maybe_arm_turn_timer(session, game, game_state)
    await bot_runner.maybe_schedule_bot_turn(session, game, game_state)


async def _handle_game_intent(
    session, game: Game, sender_id: str, intent: str, data: dict
) -> None:
    result = await apply_game_intent(store, session, game, sender_id, intent, data)

    if result.notice is not None:
        # the action was accepted but did something the player must be told
        # about (below-threshold melds returned to hand) -- reuse the
        # action_error channel so the client shows its usual toast
        await manager.send_to(
            game.id,
            sender_id,
            {"type": "action_error", "data": {"reason": result.notice}},
        )

    if not result.deal_completed:
        await manager.broadcast_personalized(
            game.id,
            lambda pid: build_client_game_state(
                result.game_state, pid, result.action_event
            ),
        )
        await _maybe_arm_turn_timer(session, game, result.game_state)
        await bot_runner.maybe_schedule_bot_turn(session, game, result.game_state)
        return

    result.deal_result_message["data"]["last_action"] = result.action_event
    await manager.broadcast(game.id, result.deal_result_message)
    if result.winner_team_id is not None:
        await manager.broadcast(
            game.id,
            {"type": "game_over", "data": {"winner_team": result.winner_team_id}},
        )
        turn_timer.cancel_game(game.id)
    else:
        transition_ends_at = result.game_state.between_deals_until
        assert transition_ends_at is not None
        _schedule_next_deal(game.id, transition_ends_at)


async def _handle_intent(game_id: str, sender_id: str, message: dict) -> None:
    intent = message.get("type")
    data = message.get("data", {})

    async with async_session() as session:
        game = await session.get(Game, game_id)
        sender = await session.get(Player, sender_id)
        if game is None or sender is None:
            return

        try:
            if intent == "assign_seat":
                await _handle_assign_seat(session, game, sender, data)
            elif intent == "add_bot":
                await _handle_add_bot(session, game, sender, data)
            elif intent == "remove_player":
                await _handle_remove_player(session, game, sender, data)
            elif intent == "set_lobby_settings":
                await _handle_set_lobby_settings(session, game, sender, data)
            elif intent == "start_game":
                await _handle_start_game(session, game, sender)
            elif intent == "skip_turn_with_penalty":
                await _handle_skip_turn_with_penalty(session, game, sender)
            elif intent == "send_chat":
                await _handle_send_chat(session, game, sender, data)
            elif intent in GAME_INTENTS:
                await _handle_game_intent(session, game, sender_id, intent, data)
            else:
                raise LobbyActionError(f"unknown intent {intent!r}")
        except (LobbyActionError, IllegalActionError) as exc:
            await manager.send_to(
                game_id,
                sender_id,
                {"type": "action_error", "data": {"reason": str(exc)}},
            )


@router.websocket("/ws/games/{game_id}")
async def game_ws(websocket: WebSocket, game_id: str, token: str) -> None:
    async with async_session() as session:
        game = await session.get(Game, game_id)
        player = None
        if game is not None:
            player = (
                await session.scalars(
                    select(Player).where(
                        Player.game_id == game_id, Player.session_token == token
                    )
                )
            ).first()

        if game is None or player is None:
            await websocket.close(code=4001)
            return

        await websocket.accept()
        player.connected = True
        await session.commit()
        manager.register(game_id, player.id, websocket)

        if game.status == "LOBBY":
            await manager.broadcast(game_id, await _lobby_state_message(session, game))
        else:
            # FR-36: reconnect snapshot is just the same full GameState the
            # Redis store already holds -- it carries turn_state.phase, so
            # the player lands back on exactly the phase they left on. If
            # this player's turn had timed out, they're back -- cancel it.
            turn_timer.cancel_for_player(game_id, player.id)
            await manager.broadcast(
                game_id, _player_connection_message(player.id, True)
            )
            game_state = store.get_state(game_id)
            if game_state is not None:
                await websocket.send_json(
                    build_client_game_state(game_state, player.id)
                )
                if game_state.between_deals_until is not None:
                    latest = game_state.deal_history[-1]
                    await websocket.send_json(
                        {
                            "type": "deal_result",
                            "data": {
                                "deal_number": latest.deal_number,
                                "scores_breakdown": latest.score_breakdown,
                                "team_scores_after": latest.team_scores_after,
                                "next_deal": True,
                                "transition_ends_at": game_state.between_deals_until,
                            },
                        }
                    )
                    _schedule_next_deal(game_id, game_state.between_deals_until)

    try:
        while True:
            message = await websocket.receive_json()
            await _handle_intent(game_id, player.id, message)
    except WebSocketDisconnect:
        # Unregister before broadcasting -- the disconnecting player's own
        # socket is already closed at the transport level, so sending to it
        # would raise.
        manager.unregister(game_id, player.id)
        async with async_session() as session:
            disconnected = await session.get(Player, player.id)
            if disconnected is not None:
                disconnected.connected = False
                game = await session.get(Game, game_id)
                await session.commit()
                if game is not None and game.status == "LOBBY":
                    await manager.broadcast(
                        game_id, await _lobby_state_message(session, game)
                    )
                elif game is not None and game.status == "IN_PROGRESS":
                    await manager.broadcast(
                        game_id, _player_connection_message(player.id, False)
                    )
                    game_state = store.get_state(game_id)
                    if game_state is not None:
                        await _maybe_arm_turn_timer(session, game, game_state)
