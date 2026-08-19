// Per-game session persistence: survives a page refresh so reloading the
// lobby/game tab doesn't orphan the player from their seat.

export interface StoredSession {
  playerId: string
  sessionToken: string
}

function key(gameId: string): string {
  return `canasta:session:${gameId}`
}

export function saveSession(gameId: string, session: StoredSession): void {
  localStorage.setItem(key(gameId), JSON.stringify(session))
}

export function loadSession(gameId: string): StoredSession | null {
  const raw = localStorage.getItem(key(gameId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function removeSession(gameId: string): void {
  localStorage.removeItem(key(gameId))
}
