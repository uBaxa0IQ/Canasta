import { motion } from 'framer-motion'
import { cardLabel, parseSequenceAnchor, SEQUENCE_RANKS, suitSymbol } from '../lib/cards'
import type { Meld } from '../lib/protocol'

export type WildSide = 'low' | 'high'

interface WildSideChooserProps {
  meld: Meld
  onChoose: (side: WildSide) => void
  onCancel: () => void
}

export function WildSideChooser({ meld, onChoose, onCancel }: WildSideChooserProps) {
  const anchor = parseSequenceAnchor(meld.rank_or_suit_anchor)
  const size = meld.slots.length
  const lowRank = anchor && anchor.startIndex > 0 ? SEQUENCE_RANKS[anchor.startIndex - 1] : null
  const highRank =
    anchor && anchor.startIndex + size < SEQUENCE_RANKS.length
      ? SEQUENCE_RANKS[anchor.startIndex + size]
      : null
  const suit = anchor ? suitSymbol(anchor.suit) : ''
  const visibleCards = meld.slots.filter((card) => card !== null).map((card) => cardLabel(card))

  return (
    <div className="modal-overlay" role="dialog" aria-label="wild-side-chooser">
      <motion.div
        className="panel wild-side-panel"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      >
        <h3>Куда поставить козырь?</h3>
        <div className="wild-sequence-preview" aria-label="Текущий ряд">
          {visibleCards.map((label, index) => (
            <span key={`${label}-${index}`} className="wild-sequence-card">
              {label}
            </span>
          ))}
        </div>
        <div className="wild-side-options">
          {lowRank !== null && (
            <button
              type="button"
              className="btn btn-primary wild-side-option"
              onClick={() => onChoose('low')}
            >
              <span className="wild-side-option-rank">
                ← {lowRank}
                {suit}
              </span>
            </button>
          )}
          {highRank !== null && (
            <button
              type="button"
              className="btn btn-primary wild-side-option"
              onClick={() => onChoose('high')}
            >
              <span className="wild-side-option-rank">
                {highRank}
                {suit} →
              </span>
            </button>
          )}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Отмена
        </button>
      </motion.div>
    </div>
  )
}
