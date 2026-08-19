const origins = new Map<string, DOMRect>()

export function captureCardOrigins(cardIds: string[]): void {
  for (const cardId of cardIds) {
    const escaped = cardId.replaceAll('"', '\\"')
    const card = document.querySelector<HTMLElement>(`[data-card-id="${escaped}"]`)
    if (card) origins.set(cardId, card.getBoundingClientRect())
  }
}

export function cardOrigin(cardId: string | undefined): DOMRect | null {
  return cardId ? (origins.get(cardId) ?? null) : null
}

export function clearCardOrigins(cardIds: string[]): void {
  for (const cardId of cardIds) origins.delete(cardId)
}

export function resetCardOrigins(): void {
  origins.clear()
}
