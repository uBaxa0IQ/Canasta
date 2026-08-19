import type { WildSide } from './WildSideChooser'

interface CreateWildPlacement {
  lowLabel: string
  highLabel: string
}

interface GameActionPanelProps {
  visible: boolean
  phase: string
  canCreateMeld: boolean
  selectedCount: number
  createWildPlacement: CreateWildPlacement | null
  createWildSide: WildSide
  onCreateWildSideChange: (side: WildSide) => void
  onCreateMeld: () => void
}

export function GameActionPanel({
  visible,
  phase,
  canCreateMeld,
  selectedCount,
  createWildPlacement,
  createWildSide,
  onCreateWildSideChange,
  onCreateMeld,
}: GameActionPanelProps) {
  if (!visible) {
    return <section className="game-action-panel is-idle" aria-label="actions" aria-hidden />
  }

  const hasWildChoice = phase === 'ACT' && createWildPlacement !== null
  const hasActButtons = phase === 'ACT' && canCreateMeld
  const showPanel = visible && (hasWildChoice || hasActButtons)

  return (
    <section
      className={`game-action-panel${showPanel ? ' is-visible' : ' is-idle'}`}
      aria-label="actions"
      aria-hidden={!showPanel}
    >
      {hasWildChoice && (
        <div className="wild-side-options-inline" role="radiogroup" aria-label="Сторона козыря">
          <button
            type="button"
            className={`btn btn-compact wild-side-option${createWildSide === 'low' ? ' is-active' : ''}`}
            aria-pressed={createWildSide === 'low'}
            onClick={() => onCreateWildSideChange('low')}
          >
            <span className="wild-side-option-rank">{createWildPlacement.lowLabel}</span>
          </button>
          <button
            type="button"
            className={`btn btn-compact wild-side-option${createWildSide === 'high' ? ' is-active' : ''}`}
            aria-pressed={createWildSide === 'high'}
            onClick={() => onCreateWildSideChange('high')}
          >
            <span className="wild-side-option-rank">{createWildPlacement.highLabel}</span>
          </button>
        </div>
      )}

      {phase === 'ACT' && (
        <div className="action-panel-group action-panel-group-act">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canCreateMeld}
            onClick={onCreateMeld}
          >
            Новая комбинация{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      )}
    </section>
  )
}
