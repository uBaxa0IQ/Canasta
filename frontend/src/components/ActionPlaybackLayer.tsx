import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { cardOrigin, clearCardOrigins } from '../lib/actionOrigins'
import type { Card } from '../lib/protocol'
import { useActionPlaybackStore } from '../stores/actionPlaybackStore'
import { PlayingCard } from './PlayingCard'

interface ActionPlaybackLayerProps {
  viewerId: string | null
  viewerTeamId: string | null
}

interface Flight {
  id: string
  playbackId: string
  card?: Card
  faceDown: boolean
  from: DOMRect
  to: DOMRect
  width: number
  height: number
  delay: number
  reveal?: boolean
}

function elementFor(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector)
}

function playerSelector(playerId: string, viewerId: string | null): string {
  return playerId === viewerId ? '.hand-dock' : `.seat-player[data-seat-player-id="${playerId}"]`
}

function playerCardSelector(playerId: string, viewerId: string | null): string {
  return playerId === viewerId
    ? '.hand-dock .playing-card'
    : `.seat-player[data-seat-player-id="${playerId}"] .card-pile-layer:last-child .playing-card`
}

function teamSelector(teamId: string): string {
  return `.team-zone[data-team-id="${teamId}"]`
}

function meldSelector(meldId: string | null, teamId: string): string {
  return meldId ? `[aria-label="meld-${meldId}"]` : teamSelector(teamId)
}

function cardSelector(cardId: string): string {
  return `[data-card-id="${cardId.replaceAll('"', '\\"')}"]`
}

function rect(element: Element | DOMRect | null): DOMRect | null {
  if (!element) return null
  return 'getBoundingClientRect' in element ? element.getBoundingClientRect() : element
}

function cardTarget(
  card: Card | undefined,
  scopeSelector: string,
  fallbackSelector: string,
): HTMLElement | null {
  if (card) {
    const exact = document.querySelector<HTMLElement>(`${scopeSelector} ${cardSelector(card.id)}`)
    if (exact) return exact
  }
  return elementFor(fallbackSelector)
}

function flightStyle(flight: Flight): CSSProperties {
  return {
    '--flight-card-w': `${flight.width}px`,
    '--flight-card-h': `${flight.height}px`,
  } as CSSProperties
}

export function ActionPlaybackLayer({ viewerId, viewerTeamId }: ActionPlaybackLayerProps) {
  const event = useActionPlaybackStore((state) => state.queue[0] ?? null)
  const advance = useActionPlaybackStore((state) => state.advance)
  const [flights, setFlights] = useState<Flight[]>([])

  const effect = useMemo(() => {
    if (!event) return null
    const affectedTeam = event.team_id === viewerTeamId ? '.hand-dock' : teamSelector(event.team_id)
    if (event.penalty_delta < 0) {
      return {
        text: `${event.penalty_delta}`,
        tone: 'penalty',
        selector: playerSelector(event.actor_id, viewerId),
      }
    }
    if (event.deal_completed) {
      return {
        text: 'Выход!',
        tone: 'exit',
        selector: playerSelector(event.actor_id, viewerId),
      }
    }
    if (event.canasta_completed) {
      return {
        text: event.team_opened ? 'Канаста! Команда открылась' : 'Канаста!',
        tone: 'canasta',
        selector: meldSelector(event.meld_id, event.team_id),
      }
    }
    if (event.team_opened) {
      return { text: 'Команда открылась', tone: 'opened', selector: affectedTeam }
    }
    return null
  }, [event, viewerId, viewerTeamId])

  const [effectPosition, setEffectPosition] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!event) return

    const actor = playerSelector(event.actor_id, viewerId)
    const actorCard = playerCardSelector(event.actor_id, viewerId)
    const meld = meldSelector(event.meld_id, event.team_id)
    const hidden = new Map<HTMLElement, string>()
    const nextFlights: Flight[] = []

    const hideDestination = (element: HTMLElement | null) => {
      if (!element || hidden.has(element)) return
      hidden.set(element, element.style.visibility)
      element.style.visibility = 'hidden'
    }
    const restoreDestinations = () => {
      for (const [element, visibility] of hidden) element.style.visibility = visibility
      hidden.clear()
    }
    const addFlight = (
      card: Card | undefined,
      source: Element | DOMRect | null,
      destination: HTMLElement | null,
      index: number,
      options: { faceDown?: boolean; reveal?: boolean; hide?: boolean } = {},
    ) => {
      const from = rect(source)
      const to = rect(destination)
      if (!from || !to) return
      if (options.hide !== false) hideDestination(destination)
      nextFlights.push({
        id: `${event.playbackId}-${card?.id ?? index}`,
        playbackId: event.playbackId,
        card,
        faceDown: options.faceDown ?? false,
        from,
        to,
        width: to.width || 74,
        height: to.height || 106,
        delay: index * 0.055,
        reveal: options.reveal,
      })
    }

    const isOwnGesture =
      event.actor_id === viewerId && ['add_to_meld', 'discard'].includes(event.action)

    if (event.action === 'draw_deck') {
      const source =
        elementFor('.deck-pile-btn .card-pile-layer:last-child .playing-card') ??
        elementFor('.pile:not(.discard-pile)')
      const cards = event.drawn_cards.length > 0 ? event.drawn_cards : [undefined]
      cards.slice(0, 8).forEach((card, index) => {
        const destination =
          event.actor_id === viewerId
            ? cardTarget(card, '.hand-dock', '.hand-dock .playing-card:last-child')
            : elementFor(actorCard)
        addFlight(card, source, destination, index, {
          faceDown: event.actor_id !== viewerId,
          reveal: event.actor_id === viewerId,
        })
      })
    } else if (event.action === 'draw_discard') {
      const source =
        elementFor('.discard-pile .card-pile-layer:last-child .playing-card') ??
        elementFor('.discard-pile')
      const cards: Array<Card | undefined> =
        event.drawn_cards.length > 0
          ? event.drawn_cards
          : Array.from({ length: Math.max(1, event.draw_count) })
      cards.slice(0, 8).forEach((card, index) => {
        const destination =
          event.actor_id === viewerId
            ? cardTarget(card, '.hand-dock', '.hand-dock .playing-card:last-child')
            : elementFor(actorCard)
        addFlight(card, source, destination, index, {
          faceDown: event.actor_id !== viewerId,
        })
      })
    } else if (event.action === 'discard' && !isOwnGesture) {
      const card = event.cards[0]
      const destination = cardTarget(
        card,
        '.discard-pile',
        '.discard-pile .card-pile-layer:last-child .playing-card',
      )
      addFlight(card, elementFor(actorCard) ?? elementFor(actor), destination, 0, {
        reveal: true,
      })
    } else if (
      (event.action === 'create_meld' || event.action === 'add_to_meld') &&
      !isOwnGesture
    ) {
      event.cards.slice(0, 8).forEach((card, index) => {
        addFlight(
          card,
          cardOrigin(card.id) ?? elementFor(actorCard) ?? elementFor(actor),
          cardTarget(card, meld, `${meld} .playing-card:last-child`),
          index,
          { reveal: event.actor_id !== viewerId },
        )
      })
    } else if (event.action === 'steal_wild') {
      const replacement =
        event.cards.find((card) => card.id === event.replacement_card_id) ?? event.cards[0]
      const stolen =
        event.drawn_cards.find((card) => card.id === event.stolen_card_id) ?? event.drawn_cards[0]
      if (event.actor_id !== viewerId) {
        addFlight(
          replacement,
          elementFor(actorCard) ?? elementFor(actor),
          cardTarget(replacement, meld, `${meld} .playing-card:last-child`),
          0,
          { reveal: true },
        )
      }
      const stolenTarget =
        event.actor_id === viewerId
          ? cardTarget(stolen, '.hand-dock', '.hand-dock .playing-card:last-child')
          : elementFor(actorCard)
      addFlight(
        stolen,
        elementFor(`${meld} ${cardSelector(event.replacement_card_id ?? '')}`) ?? elementFor(meld),
        stolenTarget,
        event.actor_id === viewerId ? 0 : 1,
        { faceDown: event.actor_id !== viewerId },
      )
    }

    let nextEffectPosition: { x: number; y: number } | null = null
    if (effect) {
      const anchor = rect(elementFor(effect.selector))
      nextEffectPosition = anchor
        ? { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height / 2 }
        : null
    }
    const renderFrame = window.requestAnimationFrame(() => {
      setFlights(nextFlights)
      setEffectPosition(nextEffectPosition)
    })

    const duration = nextFlights.length > 0 ? 760 : effect ? 620 : 0
    const finishTimer = window.setTimeout(() => {
      restoreDestinations()
      clearCardOrigins([
        ...event.cards.map((card) => card.id),
        ...event.drawn_cards.map((card) => card.id),
      ])
      advance(event.playbackId)
    }, duration)

    return () => {
      window.cancelAnimationFrame(renderFrame)
      window.clearTimeout(finishTimer)
      restoreDestinations()
    }
  }, [advance, effect, event, viewerId])

  const visibleFlights = event
    ? flights.filter((flight) => flight.playbackId === event.playbackId)
    : []

  return (
    <div className="action-playback-layer" aria-hidden>
      <AnimatePresence>
        {visibleFlights.map((flight) => {
          const startX = flight.from.left + flight.from.width / 2 - flight.width / 2
          const startY = flight.from.top + flight.from.height / 2 - flight.height / 2
          const endX = flight.to.left + flight.to.width / 2 - flight.width / 2
          const endY = flight.to.top + flight.to.height / 2 - flight.height / 2
          return (
            <motion.div
              key={flight.id}
              className="action-flight-card"
              style={flightStyle(flight)}
              initial={{ x: startX, y: startY, opacity: 1, scale: 1, rotate: -5 }}
              animate={{ x: endX, y: endY, opacity: 1, scale: [1, 1.04, 1], rotate: 0 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.58,
                delay: flight.delay,
                ease: [0.22, 0.8, 0.25, 1],
              }}
            >
              {flight.reveal && flight.card ? (
                <motion.span
                  className="action-flight-flipper"
                  initial={{ rotateY: 180 }}
                  animate={{ rotateY: 0 }}
                  transition={{ duration: 0.34, delay: flight.delay + 0.16 }}
                >
                  <span className="action-flight-face is-front">
                    <PlayingCard card={flight.card} />
                  </span>
                  <span className="action-flight-face is-back">
                    <PlayingCard faceDown />
                  </span>
                </motion.span>
              ) : (
                <PlayingCard card={flight.card} faceDown={flight.faceDown || !flight.card} />
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      <AnimatePresence>
        {event && effect && effectPosition && (
          <motion.span
            key={`${event.playbackId}-effect`}
            className={`action-effect-burst is-${effect.tone}`}
            style={{ left: effectPosition.x, top: effectPosition.y }}
            initial={{ opacity: 0, y: 10, scale: 0.65 }}
            animate={{ opacity: [0, 1, 1, 0], y: [10, -4, -18, -34], scale: [0.65, 1.08, 1, 0.95] }}
            transition={{ duration: 0.62, ease: 'easeOut' }}
          >
            {effect.text}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
