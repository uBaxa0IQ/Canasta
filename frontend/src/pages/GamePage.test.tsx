import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameStateData } from '../lib/protocol'
import { useChatStore } from '../stores/chatStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useDragStore } from '../stores/dragStore'
import { useEventLogStore } from '../stores/eventLogStore'
import { useGameStore } from '../stores/gameStore'
import { useHandOrderStore } from '../stores/handOrderStore'
import { useLobbyStore } from '../stores/lobbyStore'
import { GamePage } from './GamePage'

function dragCardTo(cardEl: Element, dropZoneSelector: string) {
  const zoneEl = document.querySelector(dropZoneSelector)
  if (!zoneEl) throw new Error(`drop zone not found: ${dropZoneSelector}`)
  document.elementFromPoint = vi.fn().mockReturnValue(zoneEl)

  act(() => {
    cardEl.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 0, bubbles: true }),
    )
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 0 }))
    window.dispatchEvent(new PointerEvent('pointerup'))
  })
}

function baseGameState(overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    hands: {
      p1: [
        { id: 'c1', rank: '7', suit: 'HEARTS' },
        { id: 'c2', rank: '7', suit: 'CLUBS' },
        { id: 'c3', rank: '7', suit: 'SPADES' },
      ],
      p2: 10,
      p3: 11,
      p4: 11,
    },
    melds: {
      A: [],
      B: [
        {
          id: 'm1',
          team_id: 'B',
          kind: 'SET',
          rank_or_suit_anchor: '8',
          slots: [
            { id: 'w1', rank: 'JOKER', suit: null },
            { id: 'w2', rank: '8', suit: 'SPADES' },
            { id: 'w3', rank: '8', suit: 'HEARTS' },
          ],
        },
      ],
    },
    deck_count: 40,
    discard_pile: [],
    discard_count: 0,
    scores: { A: 0, B: 0 },
    thresholds: { A: 50, B: 50 },
    turn_player_id: 'p1',
    turn_phase: 'ACT',
    must_meld_after_pickup: false,
    melds_created_this_turn: 0,
    pending_penalty: false,
    team_opened: { A: false, B: false },
    turn_accumulator: { A: 0, B: 0 },
    ...overrides,
  }
}

function setupPlayers() {
  useLobbyStore.setState({
    players: [
      {
        id: 'p1',
        name: 'Alice',
        seat: 0,
        team_id: 'A',
        connected: true,
        is_host: true,
        is_bot: false,
      },
      {
        id: 'p2',
        name: 'Bob',
        seat: 1,
        team_id: 'B',
        connected: true,
        is_host: false,
        is_bot: false,
      },
      {
        id: 'p3',
        name: 'Carol',
        seat: 2,
        team_id: 'A',
        connected: true,
        is_host: false,
        is_bot: false,
      },
      {
        id: 'p4',
        name: 'Dave',
        seat: 3,
        team_id: 'B',
        connected: true,
        is_host: false,
        is_bot: false,
      },
    ],
    hostId: 'p1',
    settings: { targetScore: 5000, discardVisibility: 'TOP_ONLY' },
  })
}

describe('GamePage', () => {
  let send: ReturnType<typeof vi.fn<(type: string, data?: Record<string, unknown>) => void>>

  beforeEach(() => {
    useGameStore.getState().reset()
    useHandOrderStore.getState().reset()
    useChatStore.getState().reset()
    useEventLogStore.getState().reset()
    useDragStore.getState().endDrag()
    setupPlayers()
    send = vi.fn()
    useConnectionStore.setState({
      status: 'open',
      gameId: 'g1',
      playerId: 'p1',
      send,
    })
  })

  it('shows a loading placeholder before the first game_state arrives', () => {
    render(<GamePage />)
    expect(screen.getByText(/Загрузка/)).toBeInTheDocument()
  })

  it('renders own hand, opponent counts, and the deck/discard summary', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    expect(screen.getByText('7♥')).toBeInTheDocument()
    expect(screen.getByText('7♣')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Колода')).toBeInTheDocument()
    expect(screen.getByText('40 карт')).toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: /Варианты отображения/ }),
    ).not.toBeInTheDocument()
  })

  it('shows turn state on the table without a text banner', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        turn_phase: 'DRAW',
        discard_pile: [{ id: 'd1', rank: '9', suit: 'CLUBS' }],
        discard_count: 1,
      }),
    )
    const { container } = render(<GamePage />)

    expect(screen.queryByText(/Ваш ход|Ходит /)).not.toBeInTheDocument()
    expect(screen.getByLabelText('hand-area')).toHaveClass('is-my-turn')
    expect(screen.getByLabelText('hand-area')).not.toHaveClass('is-action-phase')
    expect(container.querySelector('.pile:not(.discard-pile)')).toHaveClass('is-actionable')
    expect(container.querySelector('.discard-pile')).toHaveClass('is-actionable')
  })

  it('pulses the hand panel after the player has drawn', () => {
    useGameStore.getState().applyGameState(baseGameState({ turn_phase: 'ACT' }))
    render(<GamePage />)

    expect(screen.getByLabelText('hand-area')).toHaveClass('is-my-turn', 'is-action-phase')
  })

  it('keeps the current opponent highlight static after their draw', () => {
    useGameStore
      .getState()
      .applyGameState(baseGameState({ turn_player_id: 'p2', turn_phase: 'ACT' }))
    render(<GamePage />)

    const playerTag = screen.getByText('Bob').closest('.seat-name-tag')
    expect(playerTag).toHaveClass('is-turn')
    expect(playerTag).not.toHaveClass('is-awaiting-draw')
  })

  it('places action errors inside the game playfield', () => {
    useGameStore.getState().applyGameState(baseGameState())
    useGameStore.getState().applyActionError('it is not your turn')
    const { container } = render(<GamePage />)

    const playfield = container.querySelector('.game-playfield')
    expect(playfield).not.toBeNull()
    expect(within(playfield as HTMLElement).getByRole('alert')).toBeInTheDocument()
  })

  it('marks the partner and opponents with relation icons', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    expect(screen.getByRole('img', { name: 'Напарник' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Соперник' })).toHaveLength(2)
  })

  it('renders player, deck, and discard piles with one to three visible cards', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        hands: {
          p1: [{ id: 'c1', rank: '7', suit: 'HEARTS' }],
          p2: 1,
          p3: 2,
          p4: 8,
        },
        deck_count: 2,
        discard_pile: [{ id: 'd1', rank: '9', suit: 'CLUBS' }],
        discard_count: 7,
      }),
    )
    const { container } = render(<GamePage />)

    expect(container.querySelector('[data-player-id="p2"]')).toHaveAttribute(
      'data-stack-depth',
      '1',
    )
    expect(container.querySelector('[data-player-id="p3"]')).toHaveAttribute(
      'data-stack-depth',
      '2',
    )
    expect(container.querySelector('[data-player-id="p4"]')).toHaveAttribute(
      'data-stack-depth',
      '3',
    )
    expect(container.querySelector('[data-card-stack="deck"]')).toHaveAttribute(
      'data-stack-depth',
      '2',
    )
    expect(container.querySelector('[data-card-stack="discard"]')).toHaveAttribute(
      'data-stack-depth',
      '3',
    )
  })

  it('sends draw_deck when drawing during the DRAW phase on my turn', async () => {
    useGameStore.getState().applyGameState(baseGameState({ turn_phase: 'DRAW' }))
    render(<GamePage />)

    await userEvent.click(screen.getByLabelText('Взять из колоды'))
    expect(send).toHaveBeenCalledWith('draw_deck', {})
  })

  it('creates a meld from selected hand cards and clears the selection', async () => {
    useGameStore.getState().applyGameState(baseGameState())
    const { container } = render(<GamePage />)

    await userEvent.click(screen.getByText('7♥'))
    await userEvent.click(screen.getByText('7♣'))
    await userEvent.click(screen.getByText('7♠'))
    expect(container.querySelector('.game-command-dock')).toHaveClass('is-expanded')
    await userEvent.click(screen.getByRole('button', { name: /Новая комбинация/ }))

    expect(send).toHaveBeenCalledWith('create_meld', {
      card_ids: ['c1', 'c2', 'c3'],
      wild_side: 'low',
    })
    expect(screen.getByRole('button', { name: '7♥' })).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('.game-command-dock')).not.toHaveClass('is-expanded')
  })

  it('shows exact wild placement choices when creating an ambiguous sequence', async () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        hands: {
          p1: [
            { id: 's7', rank: '7', suit: 'SPADES' },
            { id: 's8', rank: '8', suit: 'SPADES' },
            { id: 'joker', rank: 'JOKER', suit: null },
          ],
          p2: 10,
          p3: 11,
          p4: 11,
        },
      }),
    )
    render(<GamePage />)

    const hand = within(screen.getByLabelText('hand'))
    await userEvent.click(hand.getByRole('button', { name: '7♠' }))
    await userEvent.click(hand.getByRole('button', { name: '8♠' }))
    await userEvent.click(hand.getByRole('button', { name: 'JOKER' }))

    expect(screen.getByText('6♠')).toBeInTheDocument()
    expect(screen.getByText('9♠')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '9♠' }))
    await userEvent.click(screen.getByRole('button', { name: /Новая комбинация/ }))

    expect(send).toHaveBeenCalledWith('create_meld', {
      card_ids: ['s7', 's8', 'joker'],
      wild_side: 'high',
    })
  })

  it('does not show a discard button', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    expect(screen.queryByText('Сбросить')).not.toBeInTheDocument()
  })

  it('makes opponent wild cards drop targets without a replacement click action', async () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    await userEvent.click(within(screen.getByLabelText('meld-m1')).getByRole('button'))

    expect(screen.queryByRole('button', { name: 'JOKER' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('JOKER')).toHaveAttribute('data-drop-zone', 'wild:m1:w1')
    expect(screen.queryByText('Заменить козырь')).not.toBeInTheDocument()
  })

  it('discards a dragged hand card dropped on the discard pile', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    dragCardTo(screen.getByRole('button', { name: '7♥' }), '[data-drop-zone="discard"]')
    expect(send).toHaveBeenCalledWith('discard', { card_id: 'c1' })
  })

  it('adds a dragged hand card to an own-team meld', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        melds: {
          A: [
            {
              id: 'm2',
              team_id: 'A',
              kind: 'SET',
              rank_or_suit_anchor: '7',
              slots: [
                { id: 'c9', rank: '7', suit: 'DIAMONDS' },
                { id: 'c10', rank: '7', suit: 'SPADES' },
              ],
            },
          ],
          B: [],
        },
      }),
    )
    render(<GamePage />)

    dragCardTo(screen.getByRole('button', { name: '7♥' }), '[data-drop-zone="meld:m2"]')
    expect(send).toHaveBeenCalledWith('add_to_meld', {
      meld_id: 'm2',
      card_ids: ['c1'],
      wild_side: 'low',
    })
  })

  it('steals a wild card by dragging a hand card onto it', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    dragCardTo(screen.getByRole('button', { name: '7♥' }), '[data-drop-zone="wild:m1:w1"]')

    expect(send).toHaveBeenCalledWith('steal_wild', {
      meld_id: 'm1',
      wild_card_id: 'w1',
      replacement_card_id: 'c1',
    })
  })

  it('draws from the discard pile by dragging its top card into the hand', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        turn_phase: 'DRAW',
        discard_pile: [{ id: 'd1', rank: '9', suit: 'CLUBS' }],
        discard_count: 1,
      }),
    )
    render(<GamePage />)

    dragCardTo(screen.getByText('9♣'), '[data-drop-zone="hand"]')
    expect(send).toHaveBeenCalledWith('draw_discard', {})
  })

  it('reorders a card when dropped onto another hand slot', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    dragCardTo(screen.getByRole('button', { name: '7♣' }), '[data-drop-zone="handslot:c1"]')

    expect(send).not.toHaveBeenCalled()
    const hand = screen.getByLabelText('hand')
    const labels = Array.from(hand.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(labels).toEqual(['7♣', '7♥', '7♠'])
  })

  it("shows the threshold indicator while the viewer's team is not opened", () => {
    useGameStore.getState().applyGameState(baseGameState({ turn_accumulator: { A: 15, B: 0 } }))
    render(<GamePage />)

    const handArea = screen.getByLabelText('hand-area')
    const threshold = within(handArea).getByLabelText('threshold-A')
    expect(threshold).toHaveTextContent('Выход: 15 из 50 очков')
  })

  it('shows card prices in hover tooltips', () => {
    useGameStore.getState().applyGameState(baseGameState())
    render(<GamePage />)

    const card = screen.getByRole('button', { name: '7♥' })
    expect(within(card).getByText('5 очков')).toBeInTheDocument()
    expect(card).not.toHaveAttribute('title')
  })

  it("hides the threshold indicator once the viewer's team is opened", () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        turn_accumulator: { A: 50, B: 0 },
        team_opened: { A: true, B: false },
      }),
    )
    render(<GamePage />)

    expect(screen.queryByLabelText('threshold-A')).not.toBeInTheDocument()
  })

  it('allows discard via drag even after taking the pile without a new meld', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        must_meld_after_pickup: true,
        melds_created_this_turn: 0,
      }),
    )
    render(<GamePage />)

    expect(screen.queryByText(/Штраф −1000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Нужна новая комбинация/)).not.toBeInTheDocument()
    dragCardTo(screen.getByRole('button', { name: '7♥' }), '[data-drop-zone="discard"]')
    expect(send).toHaveBeenCalledWith('discard', { card_id: 'c1' })
  })

  it('allows discard via drag once the pickup meld requirement is satisfied', () => {
    useGameStore.getState().applyGameState(
      baseGameState({
        must_meld_after_pickup: true,
        melds_created_this_turn: 1,
        team_opened: { A: true, B: false },
      }),
    )
    render(<GamePage />)

    expect(screen.queryByText(/Штраф −1000/)).not.toBeInTheDocument()
    dragCardTo(screen.getByRole('button', { name: '7♥' }), '[data-drop-zone="discard"]')
    expect(send).toHaveBeenCalledWith('discard', { card_id: 'c1' })
  })

  it('shows the winner once the game is over and hides interactive controls', async () => {
    useGameStore.getState().applyGameState(baseGameState({ scores: { A: 5200, B: 1100 } }))
    useGameStore.getState().applyGameOver('A')
    render(<GamePage />)

    expect(await screen.findByText(/Игра окончена/)).toBeInTheDocument()
    expect(screen.getByText(/Победила команда A/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Новая комбинация/ })).not.toBeInTheDocument()
  })

  it('prefers the final deal result scores over the possibly stale game_state scores', async () => {
    useGameStore.getState().applyGameState(baseGameState({ scores: { A: 4200, B: 1100 } }))
    useGameStore.getState().applyDealResult({
      deal_number: 5,
      scores_breakdown: {
        A: {
          table_points: 200,
          canasta_bonus: 500,
          hand_penalty: 0,
          three_bonus: 100,
          exit_bonus: 200,
          total: 1000,
        },
      },
      team_scores_after: { A: 5200, B: 1100 },
      next_deal: false,
    })
    useGameStore.getState().applyGameOver('A')
    render(<GamePage />)

    const finalScores = await screen.findByLabelText('final-scores')
    expect(finalScores).toHaveTextContent('Команда A: 5200')
  })

  it('shows the deal result modal and dismisses it on click', async () => {
    useGameStore.getState().applyGameState(baseGameState())
    useGameStore.getState().applyDealResult({
      deal_number: 1,
      scores_breakdown: {
        A: {
          table_points: 200,
          canasta_bonus: 500,
          hand_penalty: 0,
          three_bonus: 100,
          exit_bonus: 200,
          total: 1000,
        },
      },
      team_scores_after: { A: 1000, B: 0 },
      next_deal: true,
    })
    render(<GamePage />)

    expect(await screen.findByText('Сдача №1 завершена')).toBeInTheDocument()
    expect(screen.getByTestId('deal-transition-layer')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Продолжить'))
    expect(screen.queryByText('Сдача №1 завершена')).not.toBeInTheDocument()
    expect(screen.getByTestId('deal-transition-layer')).toBeInTheDocument()
  })

  it('logs notable events and sends chat messages', async () => {
    useGameStore.getState().applyGameState(baseGameState())
    useEventLogStore.getState().addEntry('Bob подключился')
    render(<GamePage />)

    await userEvent.click(screen.getByRole('button', { name: /События 1/ }))
    expect(screen.getByText('Bob подключился')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Чат'))
    await userEvent.type(screen.getByLabelText('Сообщение'), 'привет')
    await userEvent.click(screen.getByText('Отправить'))

    expect(send).toHaveBeenCalledWith('send_chat', { text: 'привет' })
  })

  it('shows an offline countdown for a disconnected turn player', () => {
    useGameStore.getState().applyGameState(baseGameState({ turn_player_id: 'p2' }))
    useLobbyStore.getState().setPlayerConnected('p2', false)
    render(<GamePage />)

    expect(screen.getByText(/Bob офлайн/)).toBeInTheDocument()
    expect(screen.queryByText(/Пропустить ход/)).not.toBeInTheDocument()
  })

  it('lets the host skip a timed-out turn with a penalty', async () => {
    useGameStore.getState().applyGameState(baseGameState({ turn_player_id: 'p2' }))
    useLobbyStore.getState().setPlayerConnected('p2', false)
    useGameStore.getState().applyTurnTimerExpired('p2')
    render(<GamePage />)

    const skipButton = screen.getByText('Пропустить ход Bob со штрафом')
    await userEvent.click(skipButton)
    expect(send).toHaveBeenCalledWith('skip_turn_with_penalty', {})
  })

  it("doesn't offer the skip button to a non-host viewer", () => {
    useConnectionStore.setState({ playerId: 'p2' })
    useGameStore.getState().applyGameState(baseGameState({ turn_player_id: 'p3' }))
    useLobbyStore.getState().setPlayerConnected('p3', false)
    useGameStore.getState().applyTurnTimerExpired('p3')
    render(<GamePage />)

    expect(screen.queryByText(/Пропустить ход/)).not.toBeInTheDocument()
    expect(screen.getByText(/Хост может пропустить его ход/)).toBeInTheDocument()
  })
})
