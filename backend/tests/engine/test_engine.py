from app.engine.actions import (
    AddToMeld,
    CreateMeld,
    Discard,
    DrawDeck,
    DrawDiscard,
    StealWild,
)
from app.engine.engine import (
    OPENING_THRESHOLD_NOTICE,
    combined_team_hand,
    final_deal_scores,
    force_skip_turn,
    start_new_deal,
)
from app.engine.errors import IllegalActionError
from app.engine.models import Card, Rank, Suit, TeamTable
from app.engine.scoring import ExitType
from app.engine.turn_fsm import TurnPhase
from app.engine.engine import DealState, apply_action
from app.engine.turn_fsm import draw_from_deck, start_turn
from app.engine.rules import build_new_meld

import pytest


def c(rank: Rank, suit: Suit | None, tag: str) -> Card:
    return Card(id=tag, rank=rank, suit=suit)


def test_start_new_deal_deals_13_cards_each_and_preserves_108_cards() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    deal = start_new_deal(player_order, player_team, {"A": 0, "B": 0})

    for player_id in player_order:
        assert len(deal.hands[player_id]) == 13
    assert len(deal.deck) == 108 - 13 * 4
    assert deal.discard_pile == []
    assert deal.thresholds == {"A": 30, "B": 30}
    assert deal.turn_state.current_player_id == "p1"
    assert deal.turn_state.phase == TurnPhase.DRAW


def test_start_new_deal_rotates_first_player() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    deal = start_new_deal(
        player_order, player_team, {"A": 0, "B": 0}, first_player_id="p2"
    )
    assert deal.turn_state.current_player_id == "p2"

    with pytest.raises(ValueError):
        start_new_deal(
            player_order, player_team, {"A": 0, "B": 0}, first_player_id="ghost"
        )


def _build_full_deal_scenario() -> DealState:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}

    as1 = c(Rank.ACE, Suit.SPADES, "as1")
    ah1 = c(Rank.ACE, Suit.HEARTS, "ah1")
    ac1 = c(Rank.ACE, Suit.CLUBS, "ac1")
    filler1 = c(Rank.EIGHT, Suit.CLUBS, "filler1")

    nh1 = c(Rank.NINE, Suit.HEARTS, "nh1")

    ad1 = c(Rank.ACE, Suit.DIAMONDS, "ad1")
    as2 = c(Rank.ACE, Suit.SPADES, "as2")
    ah2 = c(Rank.ACE, Suit.HEARTS, "ah2")
    ac2 = c(Rank.ACE, Suit.CLUBS, "ac2")

    ts1 = c(Rank.TEN, Suit.SPADES, "ts1")

    black3_p1 = c(Rank.THREE, Suit.SPADES, "black3_p1")
    filler2b = c(Rank.NINE, Suit.CLUBS, "filler2b")
    filler3b = c(Rank.EIGHT, Suit.HEARTS, "filler3b")

    # deck.pop() draws from the end, so list the draw order in reverse.
    deck = [filler3b, filler2b, black3_p1]

    hands = {
        "p1": [as1, ah1, ac1, filler1],
        "p2": [nh1],
        "p3": [ad1, as2, ah2, ac2],
        "p4": [ts1],
    }
    teams = {"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")}

    deal = DealState(
        deck=deck,
        discard_pile=[],
        teams=teams,
        hands=hands,
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )
    return deal, {
        "as1": as1,
        "ah1": ah1,
        "ac1": ac1,
        "filler1": filler1,
        "nh1": nh1,
        "ad1": ad1,
        "as2": as2,
        "ah2": ah2,
        "ac2": ac2,
        "black3_p1": black3_p1,
        "filler2b": filler2b,
        "filler3b": filler3b,
    }


def test_full_deal_from_deal_to_exit() -> None:
    deal, cards = _build_full_deal_scenario()

    # --- Turn 1: p1 opens the team with a 30-point meld of aces, discards ---
    apply_action(deal, "p1", DrawDeck())
    assert deal.hands["p1"][-1].id == "black3_p1"

    apply_action(deal, "p1", CreateMeld(card_ids=["as1", "ah1", "ac1"]))
    assert deal.teams["A"].is_opened is True
    assert deal.teams["A"].turn_accumulator == 30

    apply_action(deal, "p1", Discard(card_id="filler1"))
    assert deal.turn_state.current_player_id == "p2"
    assert deal.hands["p1"] == [cards["black3_p1"]]

    # --- Turn 2: p2 takes the discard pile but cannot lay the required new
    # meld (rules.md section 7) -> the discard itself auto-applies -1000 ---
    apply_action(deal, "p2", DrawDiscard())
    assert deal.discard_pile == []

    apply_action(deal, "p2", Discard(card_id="nh1"))
    assert deal.penalties["B"] == -1000
    assert deal.hands["p2"] == [cards["filler1"]]
    assert deal.turn_state.current_player_id == "p3"

    # --- Turn 3: p3 closes the canasta to 7 aces, then discards the last card ---
    apply_action(deal, "p3", DrawDeck())
    meld_id = deal.teams["A"].melds[0].id
    apply_action(
        deal, "p3", AddToMeld(meld_id=meld_id, card_ids=["ad1", "as2", "ah2", "ac2"])
    )
    assert deal.teams["A"].melds[0].is_closed
    assert deal.teams["A"].melds[0].canasta_type is not None

    assert not deal.deal_over  # the drawn filler card is still in hand
    apply_action(deal, "p3", Discard(card_id="filler2b"))

    assert deal.deal_over
    assert deal.exit_team_id == "A"
    assert deal.exit_type == ExitType.DIRTY
    assert deal.turn_state.phase == TurnPhase.DEAL_END

    # --- Final scoring ---
    assert combined_team_hand(deal, "A") == [cards["black3_p1"]]
    scores = final_deal_scores(deal)

    assert scores["A"].table_points == 70  # 7 aces x 10
    assert scores["A"].canasta_bonus == 500  # clean canasta
    assert scores["A"].three_bonus == -100  # one black three left on hand
    assert scores["A"].exit_bonus == 200  # dirty exit
    assert scores["A"].total == 70 + 500 - 100 + 200

    assert scores["B"].hand_penalty == -15  # eight (5) + ten (10) left on hand
    assert scores["B"].total == -15 - 1000  # plus the concede_penalty


def test_apply_action_rejects_out_of_turn_player() -> None:
    deal, _ = _build_full_deal_scenario()
    with pytest.raises(IllegalActionError):
        apply_action(deal, "p2", DrawDeck())


def test_clean_exit_auto_triggers_when_meld_action_empties_hand() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    sevens = [c(Rank.SEVEN, Suit.SPADES, f"s{i}") for i in range(3)]
    filler = c(Rank.NINE, Suit.HEARTS, "filler")

    deal = DealState(
        deck=[filler],
        discard_pile=[],
        teams={
            "A": TeamTable(team_id="A", is_opened=True),
            "B": TeamTable(team_id="B"),
        },
        hands={"p1": list(sevens), "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )
    apply_action(deal, "p1", DrawDeck())  # hand: 3 sevens + filler
    # Add all 3 sevens as a full canasta-in-progress; still holding filler card.
    apply_action(deal, "p1", CreateMeld(card_ids=["s0", "s1", "s2"]))
    assert not deal.deal_over

    # Now grow it to 7 with more identical-rank cards to close it, using steal
    # is unnecessary here -- simulate closing directly via add_to_meld with
    # synthetic extra sevens already in hand, then discard the filler card
    # to demonstrate the dirty path is not the only route: emptying the hand
    # exactly on a meld action triggers the clean exit immediately.
    deal.hands["p1"] = [c(Rank.SEVEN, Suit.CLUBS, f"extra{i}") for i in range(4)]
    meld_id = deal.teams["A"].melds[0].id
    apply_action(
        deal,
        "p1",
        AddToMeld(meld_id=meld_id, card_ids=["extra0", "extra1", "extra2", "extra3"]),
    )

    assert deal.teams["A"].melds[0].is_closed
    assert deal.deal_over
    assert deal.exit_type == ExitType.CLEAN
    assert deal.exit_team_id == "A"
    assert deal.turn_state.phase == TurnPhase.DEAL_END


def test_empty_hand_after_meld_passes_turn_without_completed_canasta() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    fours = [
        c(Rank.FOUR, Suit.CLUBS, "c4"),
        c(Rank.FOUR, Suit.SPADES, "s4"),
        c(Rank.FOUR, Suit.HEARTS, "h4"),
    ]
    drawn_four = c(Rank.FOUR, Suit.DIAMONDS, "d4")
    deal = DealState(
        deck=[drawn_four],
        discard_pile=[],
        teams={
            "A": TeamTable(team_id="A", is_opened=True),
            "B": TeamTable(team_id="B"),
        },
        hands={"p1": fours, "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDeck())
    apply_action(deal, "p1", CreateMeld(card_ids=["c4", "s4", "h4", "d4"]))

    assert deal.hands["p1"] == []
    assert not deal.deal_over
    assert deal.exit_type is None
    assert deal.discard_pile == []
    assert deal.turn_state.current_player_id == "p2"
    assert deal.turn_state.phase == TurnPhase.DRAW


def test_adding_last_card_to_existing_meld_passes_turn() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    existing_meld = build_new_meld(
        "m1",
        "A",
        [
            c(Rank.FOUR, Suit.CLUBS, "c4"),
            c(Rank.FOUR, Suit.SPADES, "s4"),
            c(Rank.FOUR, Suit.HEARTS, "h4"),
        ],
    )
    last_card = c(Rank.FOUR, Suit.DIAMONDS, "d4")
    deal = DealState(
        deck=[],
        discard_pile=[],
        teams={
            "A": TeamTable(team_id="A", melds=[existing_meld], is_opened=True),
            "B": TeamTable(team_id="B"),
        },
        hands={"p1": [last_card], "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=draw_from_deck(start_turn("p1")),
    )

    apply_action(deal, "p1", AddToMeld(meld_id="m1", card_ids=["d4"]))

    assert deal.hands["p1"] == []
    assert deal.teams["A"].melds[0].size == 4
    assert not deal.deal_over
    assert deal.turn_state.current_player_id == "p2"
    assert deal.turn_state.phase == TurnPhase.DRAW


def test_empty_hand_does_not_allow_below_threshold_opening() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    fours = [
        c(Rank.FOUR, Suit.CLUBS, "c4"),
        c(Rank.FOUR, Suit.SPADES, "s4"),
        c(Rank.FOUR, Suit.HEARTS, "h4"),
    ]
    deal = DealState(
        deck=[],
        discard_pile=[],
        teams={"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")},
        hands={"p1": fours, "p2": [], "p3": [], "p4": []},
        thresholds={"A": 90, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=draw_from_deck(start_turn("p1")),
    )

    apply_action(deal, "p1", CreateMeld(card_ids=["c4", "s4", "h4"]))

    assert {card.id for card in deal.hands["p1"]} == {"c4", "s4", "h4"}
    assert deal.teams["A"].melds == []
    assert deal.pending_notice == OPENING_THRESHOLD_NOTICE
    assert deal.turn_state.current_player_id == "p1"
    assert deal.turn_state.phase == TurnPhase.ACT


def test_dirty_exit_allows_only_threes_left_in_hand() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    closed_meld = build_new_meld(
        "m1", "A", [c(Rank.SEVEN, Suit.SPADES, f"s{i}") for i in range(7)]
    )
    black_three = c(Rank.THREE, Suit.SPADES, "black3")
    discard_card = c(Rank.NINE, Suit.HEARTS, "discard")

    deal = DealState(
        deck=[discard_card],
        discard_pile=[],
        teams={
            "A": TeamTable(team_id="A", is_opened=True, melds=[closed_meld]),
            "B": TeamTable(team_id="B"),
        },
        hands={"p1": [black_three], "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDeck())
    apply_action(deal, "p1", Discard(card_id="discard"))

    assert deal.deal_over
    assert deal.exit_team_id == "A"
    assert deal.exit_type == ExitType.DIRTY
    assert deal.hands["p1"] == [black_three]


def test_empty_deck_draw_ends_deal_without_exit_bonus() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    deal = DealState(
        deck=[],
        discard_pile=[],
        teams={"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")},
        hands={"p1": [], "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDeck())

    assert deal.deal_over
    assert deal.exit_team_id is None
    assert deal.exit_type is None
    assert deal.turn_state.phase == TurnPhase.DEAL_END
    assert all(score.exit_bonus == 0 for score in final_deal_scores(deal).values())


def test_discard_below_threshold_rolls_melds_back_and_rejects_the_discard() -> None:
    """rules.md section 10: the opening must be covered within one turn. A
    discard that would end the turn below the threshold is rejected -- this
    turn's melds return to the hand and the player redoes the turn."""
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    low_meld = [
        c(Rank.FOUR, Suit.CLUBS, "c4"),
        c(Rank.FOUR, Suit.SPADES, "s4"),
        c(Rank.FOUR, Suit.HEARTS, "h4"),
    ]
    discard_card = c(Rank.NINE, Suit.HEARTS, "discard")
    deal = DealState(
        deck=[discard_card],
        discard_pile=[],
        teams={"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")},
        hands={"p1": list(low_meld), "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDeck())
    apply_action(deal, "p1", CreateMeld(card_ids=["c4", "s4", "h4"]))

    assert deal.teams["A"].turn_accumulator == 15
    assert deal.teams["A"].is_opened is False
    apply_action(deal, "p1", Discard(card_id="discard"))

    # discard rejected: melds are back in hand, no penalty, still p1's turn
    assert deal.pending_notice == OPENING_THRESHOLD_NOTICE
    assert deal.penalties == {}
    assert deal.teams["A"].melds == []
    assert deal.teams["A"].turn_accumulator == 0
    assert deal.turn_state.current_player_id == "p1"
    assert deal.turn_state.phase == TurnPhase.ACT
    assert deal.turn_state.melds_created_this_turn == 0
    assert {card.id for card in deal.hands["p1"]} == {"c4", "s4", "h4", "discard"}
    assert deal.discard_pile == []

    # the retried plain discard (no melds this time) ends the turn normally
    apply_action(deal, "p1", Discard(card_id="discard"))
    assert deal.turn_state.current_player_id == "p2"
    assert deal.penalties == {}


def test_discard_after_pickup_without_meld_applies_penalty() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    pickup_cards = [c(Rank.FIVE, Suit.CLUBS, f"p{i}") for i in range(5)]
    deal = DealState(
        deck=[],
        discard_pile=pickup_cards,
        teams={"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")},
        hands={"p1": [], "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDiscard())
    assert deal.turn_state.must_meld_after_pickup is True
    card_id = deal.hands["p1"][0].id
    apply_action(deal, "p1", Discard(card_id=card_id))

    assert deal.penalties["A"] == -1000
    assert deal.turn_state.current_player_id == "p2"


def test_canasta_bonus_counts_toward_opening_threshold() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}
    seven_suits = [
        Suit.CLUBS,
        Suit.SPADES,
        Suit.HEARTS,
        Suit.DIAMONDS,
        Suit.CLUBS,
        Suit.SPADES,
        Suit.HEARTS,
    ]
    sevens = [c(Rank.SEVEN, suit, f"seven{i}") for i, suit in enumerate(seven_suits)]
    discard_card = c(Rank.NINE, Suit.HEARTS, "discard")
    deal = DealState(
        deck=[discard_card],
        discard_pile=[],
        teams={"A": TeamTable(team_id="A"), "B": TeamTable(team_id="B")},
        hands={"p1": list(sevens), "p2": [], "p3": [], "p4": []},
        thresholds={"A": 150, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )

    apply_action(deal, "p1", DrawDeck())
    apply_action(deal, "p1", CreateMeld(card_ids=[card.id for card in sevens]))

    assert deal.teams["A"].turn_accumulator == 35 + 500
    assert deal.teams["A"].is_opened is True


def test_steal_wild_via_apply_action_moves_card_between_hands() -> None:
    player_order = ["p1", "p2", "p3", "p4"]
    player_team = {"p1": "A", "p2": "B", "p3": "A", "p4": "B"}

    wild = c(Rank.TWO, Suit.HEARTS, "wild1")
    opponent_meld_cards = [
        c(Rank.SEVEN, Suit.SPADES, "sev1"),
        c(Rank.SEVEN, Suit.CLUBS, "sev2"),
        wild,
    ]
    from app.engine.rules import build_new_meld

    opponent_meld = build_new_meld("oppmeld", "B", opponent_meld_cards)

    replacement = c(Rank.SEVEN, Suit.DIAMONDS, "sev_repl")
    filler = c(Rank.NINE, Suit.HEARTS, "filler")

    deal = DealState(
        deck=[filler],
        discard_pile=[],
        teams={
            "A": TeamTable(team_id="A", is_opened=True),
            "B": TeamTable(team_id="B", is_opened=True, melds=[opponent_meld]),
        },
        hands={"p1": [replacement], "p2": [], "p3": [], "p4": []},
        thresholds={"A": 30, "B": 30},
        player_order=player_order,
        player_team=player_team,
        turn_state=start_turn("p1"),
    )
    apply_action(deal, "p1", DrawDeck())
    apply_action(
        deal,
        "p1",
        StealWild(
            meld_id="oppmeld", wild_card_id="wild1", replacement_card_id="sev_repl"
        ),
    )

    assert wild in deal.hands["p1"]
    assert replacement not in deal.hands["p1"]
    assert replacement in deal.teams["B"].melds[0].slots


def test_force_skip_turn_penalizes_team_and_advances_without_touching_hand() -> None:
    deal, _ = _build_full_deal_scenario()
    stuck_player = deal.turn_state.current_player_id
    assert stuck_player == "p1"
    hand_before = list(deal.hands[stuck_player])

    force_skip_turn(deal, stuck_player)

    assert deal.hands[stuck_player] == hand_before
    assert deal.penalties["A"] == -1000
    assert deal.turn_state.current_player_id == "p2"
    assert deal.turn_state.phase == TurnPhase.DRAW
    assert not deal.deal_over


def test_force_skip_turn_rejects_wrong_target_player() -> None:
    deal, _ = _build_full_deal_scenario()
    with pytest.raises(IllegalActionError):
        force_skip_turn(deal, "p2")
