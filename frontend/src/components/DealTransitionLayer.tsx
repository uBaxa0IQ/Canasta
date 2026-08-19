import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Card } from '../lib/protocol'
import { PlayingCard } from './PlayingCard'

interface DealTransitionLayerProps {
  durationMs?: number
  onComplete?: () => void
}

interface TransitionCardLayout {
  startX: string
  startY: string
  startRotation: string
}

const START_LAYOUTS: TransitionCardLayout[] = [
  { startX: '-16vw', startY: '-39vh', startRotation: '-7deg' },
  { startX: '-8vw', startY: '-39vh', startRotation: '-3deg' },
  { startX: '0vw', startY: '-39vh', startRotation: '2deg' },
  { startX: '8vw', startY: '-39vh', startRotation: '5deg' },
  { startX: '16vw', startY: '-39vh', startRotation: '8deg' },
  { startX: '-43vw', startY: '-13vh', startRotation: '8deg' },
  { startX: '-43vw', startY: '-3vh', startRotation: '4deg' },
  { startX: '-43vw', startY: '7vh', startRotation: '-2deg' },
  { startX: '43vw', startY: '-13vh', startRotation: '-7deg' },
  { startX: '43vw', startY: '-3vh', startRotation: '-3deg' },
  { startX: '43vw', startY: '7vh', startRotation: '3deg' },
  { startX: '-17vw', startY: '38vh', startRotation: '7deg' },
  { startX: '-9vw', startY: '38vh', startRotation: '3deg' },
  { startX: '-1vw', startY: '38vh', startRotation: '-2deg' },
  { startX: '7vw', startY: '38vh', startRotation: '-5deg' },
  { startX: '15vw', startY: '38vh', startRotation: '-8deg' },
  { startX: '-29vw', startY: '-19vh', startRotation: '-4deg' },
  { startX: '27vw', startY: '-18vh', startRotation: '5deg' },
  { startX: '-27vw', startY: '19vh', startRotation: '4deg' },
  { startX: '29vw', startY: '18vh', startRotation: '-5deg' },
]

const RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5'] as const
const SUITS = ['SPADES', 'HEARTS', 'CLUBS', 'DIAMONDS'] as const

function transitionCard(index: number): Card {
  return {
    id: `deal-transition-${index}`,
    rank: RANKS[index % RANKS.length],
    suit: SUITS[index % SUITS.length],
  }
}

function cardStyle(index: number, layout: TransitionCardLayout): CSSProperties {
  const angle = (index / START_LAYOUTS.length) * Math.PI * 2 + 0.35
  const scatterRadiusX = 14 + (index % 4) * 3.8
  const scatterRadiusY = 10 + (index % 3) * 3.4
  const scatterX = Math.cos(angle) * scatterRadiusX
  const scatterY = Math.sin(angle) * scatterRadiusY
  const side = index % 2 === 0 ? -1 : 1

  return {
    '--transition-index': index,
    '--transition-start-x': layout.startX,
    '--transition-start-y': layout.startY,
    '--transition-start-r': layout.startRotation,
    '--transition-collect-r': `${(index % 7) * 1.15 - 3.5}deg`,
    '--transition-scatter-x': `${scatterX.toFixed(2)}vw`,
    '--transition-scatter-y': `${scatterY.toFixed(2)}vh`,
    '--transition-scatter-r': `${side * (18 + (index % 5) * 8)}deg`,
    '--transition-scatter-two-x': `${(-scatterX * 0.7).toFixed(2)}vw`,
    '--transition-scatter-two-y': `${(-scatterY * 0.65).toFixed(2)}vh`,
    '--transition-scatter-two-r': `${side * -(12 + (index % 5) * 5)}deg`,
    '--transition-riffle-x': `${side * (4.5 + (index % 3) * 0.8)}vw`,
    '--transition-riffle-y': `${((index % 5) - 2) * 0.7}vh`,
    '--transition-riffle-r': `${((index % 7) * 1.15 - 3.5) * 1.8}deg`,
    '--transition-interleave-x': `${side * (index % 4) * 0.35}vw`,
    '--transition-interleave-y': `${((index % 4) - 1.5) * 0.24}vh`,
    '--transition-cut-x': `${index < START_LAYOUTS.length / 2 ? '-4.2vw' : '4.2vw'}`,
    '--transition-cut-y': `${index < START_LAYOUTS.length / 2 ? '-1.2vh' : '1.2vh'}`,
    zIndex: index + 1,
  } as CSSProperties
}

export function DealTransitionLayer({
  durationMs = 10_000,
  onComplete,
}: DealTransitionLayerProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setVisible(false)
      onComplete?.()
    }, durationMs)
    return () => window.clearTimeout(id)
  }, [durationMs, onComplete])

  if (!visible) return null

  return (
    <div
      className="deal-transition-layer"
      aria-hidden
      data-testid="deal-transition-layer"
      style={
        {
          '--deal-transition-duration': `${Math.max(1, durationMs * 0.92)}ms`,
          '--deal-transition-stagger': `${Math.max(0, durationMs * 0.004)}ms`,
        } as CSSProperties
      }
    >
      <span className="deal-transition-table-glow" />
      {START_LAYOUTS.map((layout, index) => (
        <span
          key={index}
          className="deal-transition-card"
          style={cardStyle(index, layout)}
        >
          <span className="deal-transition-flipper">
            <span className="deal-transition-face is-front">
              <PlayingCard card={transitionCard(index)} showPoints={false} />
            </span>
            <span className="deal-transition-face is-back">
              <PlayingCard faceDown />
            </span>
          </span>
        </span>
      ))}
      <span className="deal-transition-ready-glow" />
    </div>
  )
}
