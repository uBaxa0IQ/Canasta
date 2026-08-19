import type { PointerEventHandler } from 'react'
import { cardPointsLabel, isRedSuit, isWildRank, suitSymbol } from '../lib/cards'
import type { Card } from '../lib/protocol'

interface PlayingCardProps {
  card?: Card
  faceDown?: boolean
  empty?: boolean
  size?: 'normal' | 'small'
  selected?: boolean
  wild?: boolean
  className?: string
  onClick?: () => void
  pressed?: boolean
  disabled?: boolean
  ariaLabel?: string
  onPointerDown?: PointerEventHandler
  dropZone?: string
  dragging?: boolean
  showPoints?: boolean
}

// Casino-style card face rendered purely with CSS/text: rank+suit corner
// index top-left, mirrored bottom-right via CSS attr(data-label), large
// center suit glyph. Wild cards (jokers and twos) get a gold inner ring so
// they read as wild at a glance.
export function PlayingCard({
  card,
  faceDown = false,
  empty = false,
  size = 'normal',
  selected = false,
  wild = false,
  className = '',
  onClick,
  pressed,
  disabled = false,
  ariaLabel,
  onPointerDown,
  dropZone,
  dragging = false,
  showPoints = true,
}: PlayingCardProps) {
  const isWild = wild || (card !== undefined && isWildRank(card.rank))
  const classes = [
    'playing-card',
    empty ? 'is-empty-slot' : faceDown || !card ? 'is-back' : 'is-face',
    !faceDown && card && isRedSuit(card.suit) ? 'is-red' : '',
    size === 'small' ? 'is-small' : '',
    selected ? 'is-selected' : '',
    !faceDown && !empty && isWild ? 'is-wild' : '',
    onClick ? 'is-selectable' : '',
    dragging ? 'is-dragging-source' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const isJoker = card?.rank === 'JOKER'
  const rankText = card ? (isJoker ? '★' : card.rank) : ''
  const suitText = card && !isJoker ? suitSymbol(card.suit) : ''
  const label = card ? (isJoker ? '★' : `${card.rank}${suitText}`) : ''
  const content = empty ? (
    <span className="card-center">—</span>
  ) : !faceDown && card ? (
    <>
      <span className="card-index">{label}</span>
      <span className={`card-center${isJoker ? ' is-joker' : ''}`}>
        {isJoker ? (
          <span className="card-center-joker">JOKER</span>
        ) : (
          <>
            <span className="card-center-rank">{rankText}</span>
            <span className="card-center-suit">{suitText}</span>
          </>
        )}
      </span>
    </>
  ) : null

  const dataLabel = !faceDown && !empty && card ? label : undefined
  const pointsLabel = showPoints && !faceDown && !empty && card ? cardPointsLabel(card) : undefined
  const pointsTooltip = pointsLabel ? (
    <span className="card-points-tooltip" aria-hidden>
      {pointsLabel}
    </span>
  ) : null

  if (onClick) {
    return (
      <button
        type="button"
        className="card-slot-btn"
        onClick={onClick}
        onPointerDown={onPointerDown}
        aria-pressed={pressed}
        disabled={disabled}
        aria-label={ariaLabel}
        data-drop-zone={dropZone}
      >
        <span className={classes} data-label={dataLabel} data-card-id={card?.id}>
          {content}
          {pointsTooltip}
        </span>
      </button>
    )
  }

  return (
    <span
      className={classes}
      data-label={dataLabel}
      data-card-id={card?.id}
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      data-drop-zone={dropZone}
    >
      {content}
      {pointsTooltip}
    </span>
  )
}
