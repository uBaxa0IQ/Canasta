import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  canastaStatus,
  cardLabel,
  isWildRank,
  parseSequenceAnchor,
  SEQUENCE_RANKS,
  suitSymbol,
} from '../lib/cards'
import { meldCardOverlapPx } from '../lib/meldLayout'
import type { Card, Meld } from '../lib/protocol'
import { useDragStore } from '../stores/dragStore'
import { PlayingCard } from './PlayingCard'

interface MeldStackProps {
  meld: Meld
  isOwnTeam: boolean
  canDragAdd?: boolean
  canDropCard?: boolean
  canStealFrom: boolean
  compact?: boolean
  singleCardCompact?: boolean
  stackCompact?: boolean
  onToggleCompact?: () => void
  highlightedCardIds?: string[]
  isRecentAction?: boolean
}

const STATUS_LABELS: Record<string, string> = {
  clean: 'Чистая канаста',
  dirty: 'Грязная канаста',
  wild: 'Козырная канаста',
}

const COLLAPSED_STATUS_LABELS: Record<string, string> = {
  clean: 'Чистая',
  dirty: 'Грязная',
  wild: 'Козырная',
}

const CANASTA_PILE_DEPTH = 3

function meldCaption(meld: Meld, cards: Card[]): string {
  if (meld.kind === 'SET') return `${meld.rank_or_suit_anchor}×${cards.length}`
  if (meld.kind === 'SEQUENCE') {
    const anchor = parseSequenceAnchor(meld.rank_or_suit_anchor)
    if (anchor) {
      const from = SEQUENCE_RANKS[anchor.startIndex]
      const to = SEQUENCE_RANKS[anchor.startIndex + cards.length - 1]
      return `${suitSymbol(anchor.suit)} ${from}–${to}`
    }
  }
  return `Козыри×${cards.length}`
}

// Every card of an in-progress meld is laid out in an overlapping strip, so
// it's always visible which rank each wild card is standing in for (the user
// picks a side when adding one). Own-team melds are drop zones for
// add_to_meld; opponents' wild cards are steal_wild drop targets.
//
// A completed canasta collapses into a tight face-down pile so a table full
// of canastas doesn't shrink everything else (FR follow-up). It expands on
// click. Drag-to-steal targets the collapsed pile when it has a single wild;
// otherwise expand the pile first to pick the wild card.
export function MeldStack({
  meld,
  isOwnTeam,
  canDragAdd = false,
  canDropCard = false,
  canStealFrom,
  compact = false,
  singleCardCompact = false,
  stackCompact = false,
  onToggleCompact,
  highlightedCardIds = [],
  isRecentAction = false,
}: MeldStackProps) {
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  const dropZoneId = `meld:${meld.id}`
  const hoveredZone = useDragStore((s) => (s.origin === 'hand' ? s.hoveredZone : null))
  const isDropTarget = canDropCard && hoveredZone === dropZoneId
  const cards = meld.slots.filter((c): c is Card => c !== null)
  const highlightedCards = new Set(highlightedCardIds)
  const status = canastaStatus(meld)
  const meldOverlap = meldCardOverlapPx(cards.length)

  const isClosedCanasta = status !== 'open'
  const stealableWilds = cards.filter(
    (c) => canStealFrom && meld.kind !== 'WILD_CANASTA' && isWildRank(c.rank),
  )
  const collapsedStealZone =
    stealableWilds.length === 1 ? `wild:${meld.id}:${stealableWilds[0].id}` : null
  const controlledExpansion = onToggleCompact !== undefined
  const collapsed = isClosedCanasta && !(controlledExpansion ? !compact : manuallyExpanded)
  const isCompactStack = stackCompact && compact

  if (collapsed || isCompactStack) {
    const pileDepth = singleCardCompact ? 1 : CANASTA_PILE_DEPTH
    const pileCards = cards.slice(-pileDepth)
    const CompactContainer: 'fieldset' | 'div' = isClosedCanasta ? 'fieldset' : 'div'
    return (
      <CompactContainer
        aria-label={`meld-${meld.id}`}
        className={`meld-stack is-collapsed status-${status}${compact ? ' is-compact' : ''}${
          isDropTarget ? ' is-drop-target' : ''
        }${isRecentAction ? ' is-recent-action' : ''}${
          isRecentAction && isClosedCanasta ? ' is-new-canasta' : ''
        }`}
      >
        {isClosedCanasta && (
          <legend className={`meld-status-legend status-${status}`}>
            {COLLAPSED_STATUS_LABELS[status]}
          </legend>
        )}
        <button
          type="button"
          className="canasta-pile-btn"
          onClick={() => {
            if (controlledExpansion) onToggleCompact()
            else setManuallyExpanded(true)
          }}
          data-drop-zone={isOwnTeam && canDragAdd ? dropZoneId : (collapsedStealZone ?? undefined)}
          aria-label={`${isClosedCanasta ? `${STATUS_LABELS[status]} ` : ''}${meldCaption(
            meld,
            cards,
          )} — показать карты`}
          title="Показать карты комбинации"
        >
          <span
            className="card-pile-stack canasta-pile"
            data-card-stack={isClosedCanasta ? 'canasta' : 'meld'}
            data-stack-depth={pileCards.length}
          >
            {pileCards.map((card, index) => (
              <span
                key={card.id}
                className={`card-pile-layer${
                  index === pileCards.length - 1 ? ' canasta-top-card' : ''
                }`}
                style={
                  {
                    '--stack-layer': index,
                    '--stack-depth': pileCards.length,
                  } as CSSProperties
                }
              >
                <PlayingCard
                  card={card}
                  size="small"
                  showPoints={false}
                  className={highlightedCards.has(card.id) ? 'is-new-card' : ''}
                  ariaLabel={cardLabel(card)}
                />
              </span>
            ))}
          </span>
        </button>
        <span className="meld-caption" title={meldCaption(meld, cards)}>
          <span className="meld-caption-text">{meldCaption(meld, cards)}</span>
        </span>
      </CompactContainer>
    )
  }

  const compactToggleable = !isClosedCanasta && onToggleCompact !== undefined
  const MeldContainer: 'fieldset' | 'div' = isClosedCanasta ? 'fieldset' : 'div'

  return (
    <MeldContainer
      aria-label={`meld-${meld.id}`}
      className={`meld-stack status-${status}${compact && !isClosedCanasta ? ' is-compact' : ''}${
        isDropTarget ? ' is-drop-target' : ''
      }${isRecentAction ? ' is-recent-action' : ''}`}
      data-drop-zone={isOwnTeam && canDragAdd ? dropZoneId : undefined}
      role={isClosedCanasta || compactToggleable ? 'button' : undefined}
      tabIndex={isClosedCanasta || compactToggleable ? 0 : undefined}
      title={
        isClosedCanasta
          ? 'Свернуть канасту'
          : compactToggleable
            ? compact
              ? 'Раскрыть комбинацию'
              : 'Свернуть комбинацию'
            : undefined
      }
      onClick={
        isClosedCanasta
          ? () => {
              if (controlledExpansion) onToggleCompact()
              else setManuallyExpanded(false)
            }
          : compactToggleable
            ? onToggleCompact
            : undefined
      }
      onKeyDown={
        isClosedCanasta || compactToggleable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (isClosedCanasta) {
                  if (controlledExpansion) onToggleCompact()
                  else setManuallyExpanded(false)
                } else onToggleCompact?.()
              }
            }
          : undefined
      }
    >
      {isClosedCanasta && (
        <legend className={`meld-status-legend status-${status}`}>{STATUS_LABELS[status]}</legend>
      )}
      <ul className="meld-cards" style={{ '--meld-overlap': `${meldOverlap}px` } as CSSProperties}>
        {cards.map((card) => {
          const stealable = canStealFrom && isWildRank(card.rank)
          return (
            <li key={card.id}>
              <span className="meld-card-wrap">
                {stealable ? (
                  <PlayingCard
                    card={card}
                    size="small"
                    wild
                    className={highlightedCards.has(card.id) ? 'is-new-card' : ''}
                    selected={hoveredZone === `wild:${meld.id}:${card.id}`}
                    dropZone={`wild:${meld.id}:${card.id}`}
                    ariaLabel={cardLabel(card)}
                  />
                ) : (
                  <PlayingCard
                    card={card}
                    size="small"
                    className={highlightedCards.has(card.id) ? 'is-new-card' : ''}
                    ariaLabel={cardLabel(card)}
                  />
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <span className="meld-caption" title={meldCaption(meld, cards)}>
        <span className="meld-caption-text">{meldCaption(meld, cards)}</span>
      </span>
    </MeldContainer>
  )
}
