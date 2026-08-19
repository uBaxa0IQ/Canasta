interface ThresholdIndicatorProps {
  teamId: string
  accumulated: number
  threshold: number
  completing?: boolean
  previewing?: boolean
}

// FR: progress toward the opening threshold, hidden once the team is
// opened. The server doesn't send is_opened explicitly (ws/serialization.py
// only sends turn_accumulator/thresholds), but engine.py's
// _maybe_open_team never resets turn_accumulator once it clears the
// threshold, so the comparison is a safe standing proxy for is_opened.
export function ThresholdIndicator({
  teamId,
  accumulated,
  threshold,
  completing = false,
  previewing = false,
}: ThresholdIndicatorProps) {
  if (accumulated >= threshold && !completing && !previewing) return null
  const pct = Math.min(100, Math.round((accumulated / threshold) * 100))

  return (
    <div
      aria-label={`threshold-${teamId}`}
      className={`threshold-indicator${completing ? ' is-completing' : ''}`}
    >
      <p className="threshold-label">
        Выход: {accumulated} из {threshold} очков
      </p>
      <div className="threshold-bar-track">
        <div className="threshold-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
