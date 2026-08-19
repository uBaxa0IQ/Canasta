import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { isOpeningThresholdRollback, translateActionError } from '../lib/errors'

const AUTO_DISMISS_MS = 6000

interface ErrorToastProps {
  reason: string | null
  onDismiss: () => void
}

// Single floating toast for action_error messages: translated to Russian,
// slides in from the top, auto-dismisses (or on click).
export function ErrorToast({ reason, onDismiss }: ErrorToastProps) {
  const isRollback = isOpeningThresholdRollback(reason)

  useEffect(() => {
    if (reason === null) return
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(id)
  }, [reason, onDismiss])

  return (
    <AnimatePresence>
      {reason !== null && (
        <motion.div
          key={reason}
          className={`error-toast${isRollback ? ' is-rollback-notice' : ''}`}
          role="alert"
          initial={{ opacity: 0, x: 20, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16, y: -6, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          <span className="error-toast-icon" aria-hidden>
            {isRollback ? '↩' : '⚠'}
          </span>
          <span className="error-toast-copy">
            <strong>{isRollback ? 'Карты вернулись' : 'Не получилось'}</strong>
            <span className="error-toast-text">{translateActionError(reason)}</span>
          </span>
          <button
            type="button"
            className="error-toast-close"
            aria-label="Закрыть"
            onClick={onDismiss}
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
