import { useEffect, useRef } from 'react'

type WebkitWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

let audioContext: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!AudioContextClass) return null
  audioContext ??= new AudioContextClass()
  return audioContext
}

function playTurnChime(): void {
  const ctx = context()
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime
  ;[523.25, 659.25].forEach((frequency, index) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = now + index * 0.11
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.085, start + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19)
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.21)
  })
}

export function useTurnSound(
  turnPlayerId: string | null | undefined,
  turnPhase: string | null | undefined,
  viewerId: string | null,
): void {
  const previousTurnPlayer = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const unlock = () => {
      const ctx = context()
      void ctx?.resume()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    const becameOwnTurn =
      viewerId !== null &&
      turnPlayerId === viewerId &&
      turnPhase === 'DRAW' &&
      previousTurnPlayer.current !== turnPlayerId
    previousTurnPlayer.current = turnPlayerId
    if (!becameOwnTurn) return
    const ctx = context()
    if (ctx?.state === 'running') playTurnChime()
  }, [turnPhase, turnPlayerId, viewerId])
}
