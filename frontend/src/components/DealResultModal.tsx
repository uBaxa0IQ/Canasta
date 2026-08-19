import type { DealScoreBreakdown } from '../lib/protocol'

interface DealResultModalProps {
  dealNumber: number
  scoresBreakdown: Record<string, DealScoreBreakdown>
  teamScoresAfter: Record<string, number>
  viewerTeamId: string | null
  nextDeal: boolean
  onDismiss: () => void
}

const BREAKDOWN_LABELS: [keyof DealScoreBreakdown, string][] = [
  ['table_points', 'Очки на столе'],
  ['canasta_bonus', 'Бонус за канасты'],
  ['hand_penalty', 'Штраф за карты на руке'],
  ['three_bonus', 'Тройки'],
  ['exit_bonus', 'Бонус за выход'],
  ['total', 'Итого за сдачу'],
]

export function DealResultModal({
  dealNumber,
  scoresBreakdown,
  teamScoresAfter,
  viewerTeamId,
  nextDeal,
  onDismiss,
}: DealResultModalProps) {
  return (
    <div className="modal-overlay">
      <div role="dialog" aria-label="deal-result" className="panel modal-panel">
        <h2>Сдача №{dealNumber} завершена</h2>
        <div className="deal-breakdown">
          {Object.entries(scoresBreakdown)
            .sort(([leftTeamId], [rightTeamId]) => {
              if (leftTeamId === viewerTeamId) return -1
              if (rightTeamId === viewerTeamId) return 1
              return 0
            })
            .map(([teamId, breakdown]) => (
              <section
                key={teamId}
                aria-label={`breakdown-${teamId}`}
                className="deal-breakdown-team"
              >
                <h3>{teamId === viewerTeamId ? 'Ваша команда' : 'Команда соперников'}</h3>
                <ul>
                  {BREAKDOWN_LABELS.map(([key, label]) => (
                    <li key={key} className={key === 'total' ? 'total-row' : ''}>
                      {label}: {breakdown[key]}
                    </li>
                  ))}
                </ul>
                <p>Счёт партии: {teamScoresAfter[teamId]}</p>
              </section>
            ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          {nextDeal ? 'Продолжить' : 'Закрыть'}
        </button>
      </div>
    </div>
  )
}
