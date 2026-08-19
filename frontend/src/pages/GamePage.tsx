import { Swords } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { MdOutlineHandshake } from 'react-icons/md'
import { ChatPanel } from '../components/ChatPanel'
import { ActionPlaybackLayer } from '../components/ActionPlaybackLayer'
import { DealResultModal } from '../components/DealResultModal'
import { DealTransitionLayer } from '../components/DealTransitionLayer'
import { DragLayer } from '../components/DragLayer'
import { ErrorToast } from '../components/ErrorToast'
import { EventLog } from '../components/EventLog'
import { GameActionPanel } from '../components/GameActionPanel'
import { GameHeader } from '../components/GameHeader'
import { GameOverModal } from '../components/GameOverModal'
import { Hand } from '../components/Hand'
import { PlayingCard } from '../components/PlayingCard'
import { TeamZone } from '../components/TeamZone'
import { ThresholdIndicator } from '../components/ThresholdIndicator'
import type { WildSide } from '../components/WildSideChooser'
import { WildSideChooser } from '../components/WildSideChooser'
import {
  canAddCardToMeld,
  cardPoints,
  compareForHand,
  isWildRank,
  parseSequenceAnchor,
  SEQUENCE_RANKS,
} from '../lib/cards'
import { makeCardDragSource } from '../lib/cardDrag'
import { captureCardOrigins } from '../lib/actionOrigins'
import { isOpeningThresholdRollback } from '../lib/errors'
import { buildGameUiModel } from '../lib/gameUiModel'
import type { Card, LobbyPlayer, Meld } from '../lib/protocol'
import { createWildPlacementOptions } from '../lib/wildPlacement'
import { useTurnSound } from '../lib/useTurnSound'
import { useChatStore } from '../stores/chatStore'
import { useConnectionStore } from '../stores/connectionStore'
import type { DragOrigin } from '../stores/dragStore'
import { useDragStore } from '../stores/dragStore'
import { useEventLogStore } from '../stores/eventLogStore'
import { useGameFeedbackStore } from '../stores/gameFeedbackStore'
import { useGameStore } from '../stores/gameStore'
import {
  orderedHand,
  reorderHand,
  syncHandOrder,
  useHandOrderStore,
} from '../stores/handOrderStore'
import { useLobbyStore } from '../stores/lobbyStore'

interface PendingWildAdd {
  meldId: string
  cardIds: string[]
}

interface ActiveDealTransition {
  dealNumber: number
  durationMs: number
}

const TURN_TIMEOUT_SECONDS = 90

function visiblePileDepth(count: number): number {
  return Math.min(3, Math.max(0, count))
}

function pileLayerStyle(layer: number, depth: number): CSSProperties {
  return { '--stack-layer': layer, '--stack-depth': depth } as CSSProperties
}

function cardCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod10 === 1 && mod100 !== 11) return `${count} карта`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} карты`
  }
  return `${count} карт`
}

function SeatRelationIcon({ relation }: { relation: 'partner' | 'opponent' }) {
  if (relation === 'partner') {
    return (
      <MdOutlineHandshake
        className="seat-relation-icon is-partner"
        role="img"
        aria-label="Напарник"
      />
    )
  }

  return (
    <Swords
      className="seat-relation-icon is-opponent"
      strokeWidth="1.8"
      role="img"
      aria-label="Соперник"
    />
  )
}

function seatTag(
  player: LobbyPlayer | undefined,
  count: number | undefined,
  isTurn: boolean,
  isAwaitingDraw: boolean,
  relation: 'partner' | 'opponent',
) {
  if (!player) return null
  const classes = [
    'seat-name-tag',
    isTurn ? 'is-turn' : '',
    isAwaitingDraw ? 'is-awaiting-draw' : '',
    !player.connected ? 'is-offline' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const name = player.is_bot ? player.name : player.name
  const visibleBacks = visiblePileDepth(count ?? 0)
  return (
    <div className="seat-player" data-seat-player-id={player.id}>
      <span className={classes}>
        <span className="seat-name">{name}</span>
        <SeatRelationIcon relation={relation} />
      </span>
      {visibleBacks > 0 && (
        <span
          className="card-pile-stack opponent-hand-stack"
          data-card-stack="player"
          data-player-id={player.id}
          data-stack-depth={visibleBacks}
          aria-hidden
        >
          {Array.from({ length: visibleBacks }, (_, index) => (
            <span
              key={index}
              className="card-pile-layer"
              style={pileLayerStyle(index, visibleBacks)}
            >
              <PlayingCard faceDown />
            </span>
          ))}
        </span>
      )}
      <span className="pile-card-count">{cardCountLabel(count ?? 0)}</span>
    </div>
  )
}

function wildSideOptions(meld: Meld): { low: boolean; high: boolean } {
  if (meld.kind !== 'SEQUENCE') return { low: false, high: false }
  const anchor = parseSequenceAnchor(meld.rank_or_suit_anchor)
  if (!anchor) return { low: false, high: false }
  return {
    low: anchor.startIndex > 0,
    high: anchor.startIndex + meld.slots.length < SEQUENCE_RANKS.length,
  }
}

export function GamePage() {
  const send = useConnectionStore((s) => s.send)
  const playerId = useConnectionStore((s) => s.playerId)
  const connectionStatus = useConnectionStore((s) => s.status)
  const liveGameState = useGameStore((s) => s.state)
  const lastDealResult = useGameStore((s) => s.lastDealResult)
  const winnerTeamId = useGameStore((s) => s.winnerTeamId)
  const lastActionError = useGameStore((s) => s.lastActionError)
  const dismissActionError = useGameStore((s) => s.dismissActionError)
  const dismissDealResult = useGameStore((s) => s.dismissDealResult)
  const timedOutPlayerId = useGameStore((s) => s.timedOutPlayerId)
  const players = useLobbyStore((s) => s.players)
  const hostId = useLobbyStore((s) => s.hostId)
  const targetScore = useLobbyStore((s) => s.settings.targetScore)
  const chatMessages = useChatStore((s) => s.messages)
  const chatUnread = useChatStore((s) => s.unread)
  const markChatRead = useChatStore((s) => s.markRead)
  const logEntries = useEventLogStore((s) => s.entries)
  const latestFeedbackEvent = useGameFeedbackStore((s) => s.latestEvent)
  const newCardIds = useGameFeedbackStore((s) => s.newCardIds)
  const recentTeamId = useGameFeedbackStore((s) => s.recentTeamId)
  const recentDiscardCardId = useGameFeedbackStore((s) => s.recentDiscardCardId)
  const acknowledgeNewCard = useGameFeedbackStore((s) => s.acknowledgeNewCard)
  const clearLatestFeedbackEvent = useGameFeedbackStore((s) => s.clearLatestEvent)

  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [pendingWildAdd, setPendingWildAdd] = useState<PendingWildAdd | null>(null)
  const [createWildSide, setCreateWildSide] = useState<WildSide>('low')
  const [offlineCountdown, setOfflineCountdown] = useState<number | null>(null)
  const [isDealing, setIsDealing] = useState(true)
  const [dealResultVisible, setDealResultVisible] = useState(false)
  const [gameOverVisible, setGameOverVisible] = useState(false)
  const [dealTransition, setDealTransition] = useState<ActiveDealTransition | null>(null)
  const isDiscardDropTarget = useDragStore(
    (s) => s.hoveredZone === 'discard' && s.origin === 'hand',
  )

  const handOrder = useHandOrderStore((s) => s.order)
  const setHandOrder = useHandOrderStore((s) => s.setOrder)
  const autoSort = useHandOrderStore((s) => s.autoSort)
  const toggleAutoSort = useHandOrderStore((s) => s.toggleAutoSort)

  useEffect(() => {
    if (!isDealing) return
    const id = window.setTimeout(() => setIsDealing(false), 1350)
    return () => window.clearTimeout(id)
  }, [isDealing])

  useEffect(() => {
    if (lastDealResult === null) return
    const transitionId = window.setTimeout(() => {
      if (!lastDealResult.nextDeal) return
      const durationMs = lastDealResult.transitionEndsAt
        ? Math.max(0, lastDealResult.transitionEndsAt * 1000 - Date.now())
        : 10_000
      setDealTransition({ dealNumber: lastDealResult.dealNumber, durationMs })
    }, 0)
    const modalId = window.setTimeout(() => setDealResultVisible(true), 720)
    return () => {
      window.clearTimeout(transitionId)
      window.clearTimeout(modalId)
    }
  }, [lastDealResult])

  const finishDealTransition = useCallback(() => {
    setDealTransition(null)
    setIsDealing(true)
  }, [])

  useEffect(() => {
    if (winnerTeamId === null) return
    const id = window.setTimeout(() => setGameOverVisible(true), 720)
    return () => window.clearTimeout(id)
  }, [winnerTeamId])

  const gameState = liveGameState

  useLayoutEffect(() => {
    if (!isDealing || liveGameState === null) return
    const deck = document.querySelector<HTMLElement>(
      '.deck-pile-btn .card-pile-layer:last-child .playing-card',
    )
    if (!deck) return
    const source = deck.getBoundingClientRect()
    const targets = document.querySelectorAll<HTMLElement>('.hand-tray > li, .opponent-hand-stack')
    targets.forEach((target, index) => {
      const inlineAnimation = target.style.animation
      const inlineTransform = target.style.transform
      target.style.animation = 'none'
      target.style.transform = 'none'
      const visualTarget = target.querySelector<HTMLElement>('.playing-card') ?? target
      const destination = visualTarget.getBoundingClientRect()
      target.style.setProperty(
        '--deal-from-x',
        `${source.left + source.width / 2 - (destination.left + destination.width / 2)}px`,
      )
      target.style.setProperty(
        '--deal-from-y',
        `${source.top + source.height / 2 - (destination.top + destination.height / 2)}px`,
      )
      target.style.setProperty('--deal-index', `${index}`)
      if (inlineAnimation) target.style.animation = inlineAnimation
      else target.style.removeProperty('animation')
      if (inlineTransform) target.style.transform = inlineTransform
      else target.style.removeProperty('transform')
    })
  }, [isDealing, liveGameState])

  useTurnSound(gameState?.turn_player_id, gameState?.turn_phase, playerId)

  const turnPlayerId = gameState?.turn_player_id ?? null
  const turnPlayer = players.find((p) => p.id === turnPlayerId)
  const turnPlayerOffline = turnPlayer !== undefined && !turnPlayer.connected

  useEffect(() => {
    const shouldCountDown = turnPlayerOffline && timedOutPlayerId !== turnPlayerId
    const resetId = window.setTimeout(
      () => setOfflineCountdown(shouldCountDown ? TURN_TIMEOUT_SECONDS : null),
      0,
    )
    if (!shouldCountDown) return () => window.clearTimeout(resetId)

    const id = setInterval(() => {
      setOfflineCountdown((c) => (c === null ? null : Math.max(0, c - 1)))
    }, 1000)
    return () => {
      window.clearTimeout(resetId)
      clearInterval(id)
    }
  }, [turnPlayerId, turnPlayerOffline, timedOutPlayerId])

  useEffect(() => {
    if (!latestFeedbackEvent) return
    const id = window.setTimeout(() => clearLatestFeedbackEvent(latestFeedbackEvent.id), 3600)
    return () => window.clearTimeout(id)
  }, [clearLatestFeedbackEvent, latestFeedbackEvent])

  const myHandRaw = gameState && playerId ? gameState.hands[playerId] : undefined
  const myHand: Card[] = useMemo(() => (Array.isArray(myHandRaw) ? myHandRaw : []), [myHandRaw])

  const syncedHandOrder = useMemo(
    () => syncHandOrder(myHand, handOrder, compareForHand, autoSort),
    [myHand, handOrder, autoSort],
  )

  useEffect(() => {
    if (syncedHandOrder.join(',') !== handOrder.join(',')) {
      setHandOrder(syncedHandOrder)
    }
  }, [syncedHandOrder, handOrder, setHandOrder])

  const myHandOrdered = useMemo(
    () => orderedHand(myHand, syncedHandOrder),
    [myHand, syncedHandOrder],
  )
  const displayedMelds = gameState?.melds ?? {}

  const connectionBanner =
    connectionStatus === 'open' ? null : (
      <div
        className={`connection-banner${connectionStatus === 'connecting' ? ' is-connecting' : ''}`}
        role="status"
      >
        <span className="spinner" />
        {connectionStatus === 'connecting' || connectionStatus === 'idle'
          ? 'Подключение к партии…'
          : 'Соединение потеряно — обновите страницу, чтобы переподключиться'}
      </div>
    )

  if (gameState === null) {
    return (
      <main className="page-shell">
        {connectionBanner}
        <p>Загрузка партии…</p>
      </main>
    )
  }

  const playerNames = Object.fromEntries(players.map((p) => [p.id, p.name]))
  const me = players.find((p) => p.id === playerId)
  const isHost = playerId !== null && playerId === hostId
  const viewerTeamId = me?.team_id ?? null
  const cardsById = new Map(myHand.map((c) => [c.id, c]))
  const handCounts: Record<string, number> = {}
  for (const [pid, hand] of Object.entries(gameState.hands)) {
    if (!Array.isArray(hand)) handCounts[pid] = hand
  }

  const bySeat = new Map(players.filter((p) => p.seat !== null).map((p) => [p.seat as number, p]))
  const mySeat = me?.seat ?? null
  const partner = mySeat !== null ? bySeat.get((mySeat + 2) % 4) : undefined
  const leftPlayer = mySeat !== null ? bySeat.get((mySeat + 1) % 4) : undefined
  const rightPlayer = mySeat !== null ? bySeat.get((mySeat + 3) % 4) : undefined

  const gameOver = winnerTeamId !== null
  const isMyTurn = !gameOver && playerId !== null && playerId === gameState.turn_player_id
  const phase = gameState.turn_phase
  const isRollbackError = isOpeningThresholdRollback(lastActionError)
  const viewerTeamOpened = viewerTeamId !== null && (gameState.team_opened[viewerTeamId] ?? false)

  const ui = buildGameUiModel({
    gameState,
    isMyTurn,
    gameOver,
    viewerTeamId,
    selectedCardCount: selectedCardIds.length,
  })

  const topDiscardCard = gameState.discard_pile[gameState.discard_pile.length - 1]
  const deckPileDepth = visiblePileDepth(gameState.deck_count)
  const discardPileDepth = visiblePileDepth(
    Math.max(gameState.discard_count, topDiscardCard === undefined ? 0 : 1),
  )
  const draggableCards = [...myHand, ...gameState.discard_pile]
  const ownMelds = viewerTeamId !== null ? (gameState.melds[viewerTeamId] ?? []) : []
  const pendingWildMeld =
    pendingWildAdd !== null ? (ownMelds.find((m) => m.id === pendingWildAdd.meldId) ?? null) : null

  const selectedCards = selectedCardIds
    .map((id) => cardsById.get(id))
    .filter((c): c is Card => c !== undefined)
  const selectedMeldPoints = selectedCards.reduce((total, card) => total + cardPoints(card), 0)
  const createWildPlacement = createWildPlacementOptions(selectedCards)
  const createNeedsWildSide = createWildPlacement !== null

  function requestAddToMeld(meldId: string, cardIds: string[]) {
    const meld = ownMelds.find((m) => m.id === meldId)
    const hasWild = cardIds.some((id) => {
      const card = cardsById.get(id)
      return card !== undefined && isWildRank(card.rank)
    })
    if (meld && hasWild) {
      const sides = wildSideOptions(meld)
      if (sides.low && sides.high) {
        setPendingWildAdd({ meldId, cardIds })
        return
      }
      send('add_to_meld', {
        meld_id: meldId,
        card_ids: cardIds,
        wild_side: sides.high ? 'high' : 'low',
      })
      return
    }
    send('add_to_meld', { meld_id: meldId, card_ids: cardIds, wild_side: 'low' })
  }

  function handleCardDrop(zone: string, cardId: string, origin: DragOrigin) {
    if (origin === 'hand') {
      if (zone.startsWith('handslot:')) {
        const targetId = zone.slice('handslot:'.length)
        if (!autoSort && cardId !== targetId) {
          setHandOrder(reorderHand(syncedHandOrder, cardId, targetId))
        }
        return
      }
      if (zone === 'hand') return
      if (!ui.dragActEnabled) return
      if (zone === 'discard') {
        if (!ui.canDiscard) return
        send('discard', { card_id: cardId })
      } else if (zone.startsWith('meld:')) {
        const meldId = zone.slice('meld:'.length)
        const meld = ownMelds.find((candidate) => candidate.id === meldId)
        const card = cardsById.get(cardId)
        if (!meld || !card || !canAddCardToMeld(meld, card)) return
        requestAddToMeld(meldId, [cardId])
      } else if (zone.startsWith('wild:')) {
        const [, meldId, wildCardId] = zone.split(':')
        send('steal_wild', {
          meld_id: meldId,
          wild_card_id: wildCardId,
          replacement_card_id: cardId,
        })
      }
    } else if (origin === 'discard' && zone === 'hand') {
      if (ui.dragDrawEnabled) send('draw_discard', {})
    }
  }

  function toggleCard(cardId: string) {
    setSelectedCardIds((ids) =>
      ids.includes(cardId) ? ids.filter((id) => id !== cardId) : [...ids, cardId],
    )
  }

  function handleCreateMeld() {
    captureCardOrigins(selectedCardIds)
    send('create_meld', {
      card_ids: selectedCardIds,
      wild_side: createNeedsWildSide ? createWildSide : 'low',
    })
    setSelectedCardIds([])
  }

  return (
    <main className="table-frame free-table-layout">
      {connectionBanner}

      {gameOver && gameOverVisible && winnerTeamId !== null && (
        <GameOverModal
          winnerTeamId={winnerTeamId}
          finalScores={lastDealResult?.teamScoresAfter ?? gameState.scores}
        />
      )}

      <div className="game-chrome">
        <GameHeader
          scores={gameState.scores}
          thresholds={gameState.thresholds}
          targetScore={targetScore}
          viewerTeamId={viewerTeamId}
        />
        {!gameOver && turnPlayerOffline && (
          <p className="status-line offline-countdown" role="status">
            {turnPlayer?.name} офлайн.{' '}
            {timedOutPlayerId === turnPlayerId
              ? isHost
                ? 'Можно пропустить ход со штрафом.'
                : 'Хост может пропустить его ход.'
              : `Автопропуск станет доступен хосту через ${offlineCountdown ?? TURN_TIMEOUT_SECONDS}с.`}
          </p>
        )}
        {!gameOver && isHost && timedOutPlayerId === turnPlayerId && (
          <div className="host-skip-bar">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => send('skip_turn_with_penalty', {})}
            >
              Пропустить ход {turnPlayer?.name} со штрафом
            </button>
          </div>
        )}
      </div>

      {dealTransition !== null && (
        <DealTransitionLayer
          key={dealTransition.dealNumber}
          durationMs={dealTransition.durationMs}
          onComplete={finishDealTransition}
        />
      )}

      {lastDealResult && dealResultVisible && !gameOver && (
        <DealResultModal
          dealNumber={lastDealResult.dealNumber}
          scoresBreakdown={lastDealResult.scoresBreakdown}
          teamScoresAfter={lastDealResult.teamScoresAfter}
          viewerTeamId={viewerTeamId}
          nextDeal={lastDealResult.nextDeal}
          onDismiss={() => {
            setDealResultVisible(false)
            dismissDealResult()
          }}
        />
      )}

      {pendingWildMeld !== null && pendingWildAdd !== null && (
        <WildSideChooser
          meld={pendingWildMeld}
          onChoose={(side) => {
            send('add_to_meld', {
              meld_id: pendingWildAdd.meldId,
              card_ids: pendingWildAdd.cardIds,
              wild_side: side,
            })
            setPendingWildAdd(null)
          }}
          onCancel={() => setPendingWildAdd(null)}
        />
      )}

      <div className="game-body">
        <div className="game-playfield">
          <ErrorToast
            reason={isRollbackError ? null : lastActionError}
            onDismiss={dismissActionError}
          />
          <div
            className={`table-felt${isDealing ? ' is-dealing' : ''}${
              dealTransition !== null ? ' is-between-deals' : ''
            }`}
            aria-label="table"
          >
            <div className="seat-slot seat-slot-top">
              {seatTag(
                partner,
                handCounts[partner?.id ?? ''],
                gameState.turn_player_id === partner?.id,
                phase === 'DRAW' && gameState.turn_player_id === partner?.id,
                'partner',
              )}
            </div>

            {Object.entries(displayedMelds)
              .filter(([teamId]) => teamId !== viewerTeamId)
              .map(([teamId, melds]) => (
                <TeamZone
                  key={teamId}
                  teamId={teamId}
                  melds={melds}
                  isOwnTeam={false}
                  canDragAdd={false}
                  canStealFrom={isMyTurn && phase === 'ACT'}
                  highlightedTeamId={latestFeedbackEvent?.meldId ? null : recentTeamId}
                  highlightedCardIds={latestFeedbackEvent?.cardIds ?? []}
                  highlightedMeldId={latestFeedbackEvent?.meldId}
                />
              ))}

            <div className="seat-slot seat-slot-left">
              {seatTag(
                leftPlayer,
                handCounts[leftPlayer?.id ?? ''],
                gameState.turn_player_id === leftPlayer?.id,
                phase === 'DRAW' && gameState.turn_player_id === leftPlayer?.id,
                'opponent',
              )}
            </div>

            <div className="seat-slot-center">
              <div
                className={`pile${ui.canDrawDeck ? ' is-actionable' : ''}${
                  latestFeedbackEvent?.type === 'draw_deck' ? ' is-recent-action' : ''
                }`}
              >
                <span className="pile-label">Колода</span>
                {gameState.deck_count > 0 ? (
                  <button
                    type="button"
                    className="deck-pile-btn"
                    aria-label="Взять из колоды"
                    disabled={!ui.canDrawDeck}
                    onClick={() => send('draw_deck', {})}
                  >
                    <span
                      className="card-pile-stack"
                      data-card-stack="deck"
                      data-stack-depth={deckPileDepth}
                    >
                      {Array.from({ length: deckPileDepth }, (_, index) => (
                        <span
                          key={index}
                          className="card-pile-layer"
                          style={pileLayerStyle(index, deckPileDepth)}
                        >
                          <PlayingCard faceDown />
                        </span>
                      ))}
                    </span>
                  </button>
                ) : (
                  <div className="discard-empty" />
                )}
                <span className="pile-card-count">{cardCountLabel(gameState.deck_count)}</span>
              </div>

              <div
                className={`pile discard-pile${isDiscardDropTarget ? ' is-drop-target' : ''}${
                  ui.canTakeDiscard ? ' is-actionable' : ''
                }${recentDiscardCardId === topDiscardCard?.id ? ' is-recent-action' : ''}`}
                data-drop-zone="discard"
              >
                <span className="pile-label">Сброс</span>
                {topDiscardCard !== undefined ? (
                  <button
                    type="button"
                    className="discard-pile-btn"
                    disabled={!ui.canTakeDiscard}
                    aria-label="Взять сброс"
                    onClick={() => send('draw_discard', {})}
                  >
                    <span
                      className="card-pile-stack discard-stack"
                      data-card-stack="discard"
                      data-stack-depth={discardPileDepth}
                    >
                      {Array.from({ length: discardPileDepth - 1 }, (_, index) => (
                        <span
                          key={index}
                          className="card-pile-layer discard-stack-layer"
                          style={pileLayerStyle(index, discardPileDepth)}
                          aria-hidden
                        />
                      ))}
                      <span
                        key={topDiscardCard.id}
                        className="card-pile-layer"
                        style={pileLayerStyle(discardPileDepth - 1, discardPileDepth)}
                      >
                        <PlayingCard
                          card={topDiscardCard}
                          onPointerDown={
                            makeCardDragSource(
                              topDiscardCard.id,
                              'discard',
                              ui.dragDrawEnabled,
                              handleCardDrop,
                            ).onPointerDown
                          }
                        />
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="discard-empty" />
                )}
                <span className="pile-card-count">{cardCountLabel(gameState.discard_count)}</span>
              </div>
            </div>

            <div className="seat-slot seat-slot-right">
              {seatTag(
                rightPlayer,
                handCounts[rightPlayer?.id ?? ''],
                gameState.turn_player_id === rightPlayer?.id,
                phase === 'DRAW' && gameState.turn_player_id === rightPlayer?.id,
                'opponent',
              )}
            </div>

            {Object.entries(displayedMelds)
              .filter(([teamId]) => teamId === viewerTeamId)
              .map(([teamId, melds]) => (
                <TeamZone
                  key={teamId}
                  teamId={teamId}
                  melds={melds}
                  isOwnTeam
                  canDragAdd={ui.dragActEnabled}
                  handCards={myHand}
                  canStealFrom={false}
                  highlightedTeamId={latestFeedbackEvent?.meldId ? null : recentTeamId}
                  highlightedCardIds={latestFeedbackEvent?.cardIds ?? []}
                  highlightedMeldId={latestFeedbackEvent?.meldId}
                />
              ))}
          </div>
        </div>

        <aside className="game-side-tools" aria-label="side-tools">
          <EventLog entries={logEntries} />
          <ChatPanel
            messages={chatMessages}
            unreadCount={chatUnread}
            playerNames={playerNames}
            onSend={(text) => send('send_chat', { text })}
            onOpen={markChatRead}
          />
        </aside>
      </div>

      <div
        className={`game-command-dock${ui.canCreateMeld ? ' is-expanded' : ''}${
          dealTransition !== null ? ' is-between-deals' : ''
        }`}
      >
        <GameActionPanel
          visible={isMyTurn && !gameOver}
          phase={phase}
          canCreateMeld={ui.canCreateMeld}
          selectedCount={selectedCardIds.length}
          createWildPlacement={createWildPlacement}
          createWildSide={createWildSide}
          onCreateWildSideChange={setCreateWildSide}
          onCreateMeld={handleCreateMeld}
        />

        <Hand
          cards={myHandOrdered}
          selectedIds={selectedCardIds}
          newCardIds={newCardIds}
          onAcknowledgeNewCard={acknowledgeNewCard}
          isMyTurn={isMyTurn}
          isActionPhase={isMyTurn && phase === 'ACT'}
          isRollbackNotice={latestFeedbackEvent?.type === 'rollback' || isRollbackError}
          isDealing={isDealing}
          progress={
            viewerTeamId !== null &&
            (!viewerTeamOpened ||
              (latestFeedbackEvent?.teamOpened && latestFeedbackEvent.teamId === viewerTeamId)) ? (
              <ThresholdIndicator
                teamId={viewerTeamId}
                accumulated={
                  gameState.turn_accumulator[viewerTeamId] +
                  (phase === 'ACT' ? selectedMeldPoints : 0)
                }
                threshold={gameState.thresholds[viewerTeamId]}
                completing={
                  viewerTeamOpened &&
                  latestFeedbackEvent?.teamOpened === true &&
                  latestFeedbackEvent.teamId === viewerTeamId
                }
                previewing={selectedCardIds.length > 0}
              />
            ) : null
          }
          autoSort={autoSort}
          onToggleAutoSort={toggleAutoSort}
          onToggleCard={toggleCard}
          onCardDrop={(zone, cardId) => handleCardDrop(zone, cardId, 'hand')}
        />
      </div>

      <DragLayer cards={draggableCards} />
      <ActionPlaybackLayer viewerId={playerId} viewerTeamId={viewerTeamId} />
    </main>
  )
}
