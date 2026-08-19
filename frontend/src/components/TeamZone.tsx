import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { canAddCardToMeld } from '../lib/cards'
import type { Card, Meld } from '../lib/protocol'
import { useDragStore } from '../stores/dragStore'
import { MeldStack } from './MeldStack'

interface TeamZoneProps {
  teamId: string
  melds: Meld[]
  isOwnTeam: boolean
  canDragAdd?: boolean
  handCards?: Card[]
  canStealFrom: boolean
  highlightedTeamId?: string | null
  highlightedCardIds?: string[]
  highlightedMeldId?: string | null
}

interface FreePosition {
  x: number
  y: number
}

interface FreeDrag {
  meldId: string
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  active: boolean
}

interface RectBounds {
  left: number
  right: number
  top: number
  bottom: number
}

function collapsedHandRect(board: HTMLElement): RectBounds | null {
  const hand = board.closest('.table-frame')?.querySelector<HTMLElement>('[aria-label="hand-area"]')
  if (!hand) return null
  const rect = hand.getBoundingClientRect()
  const handStyle = getComputedStyle(hand)
  const transform = handStyle.transform
  let translateY = 0
  if (transform.startsWith('matrix3d(')) {
    translateY = Number(transform.slice(9, -1).split(',')[13]) || 0
  } else if (transform.startsWith('matrix(')) {
    translateY = Number(transform.slice(7, -1).split(',')[5]) || 0
  }
  const cardHeight = Number.parseFloat(handStyle.getPropertyValue('--hand-card-h')) || 0
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const collapsedTranslateY = Math.max(0, cardHeight - rootFontSize * 2.25)
  const untransformedTop = rect.top - translateY
  const collapsedTop = untransformedTop + collapsedTranslateY
  return {
    left: rect.left,
    right: rect.right,
    top: collapsedTop,
    bottom: collapsedTop + rect.height,
  }
}

function freeBoardObstacle(board: HTMLElement, isOwnTeam: boolean): RectBounds | null {
  if (isOwnTeam) return collapsedHandRect(board)
  const partner = board.closest('.table-felt')?.querySelector<HTMLElement>('.seat-slot-top')
  return partner?.getBoundingClientRect() ?? null
}

function overlapsObstacle(
  left: number,
  top: number,
  width: number,
  height: number,
  obstacle: RectBounds,
  clearance: number,
): boolean {
  return (
    left + width > obstacle.left - clearance &&
    left < obstacle.right + clearance &&
    top + height > obstacle.top - clearance &&
    top < obstacle.bottom + clearance
  )
}

function projectAlongObstacle(
  left: number,
  top: number,
  width: number,
  height: number,
  obstacle: RectBounds,
  current: RectBounds,
  clearance: number,
): { left: number; top: number } {
  if (!overlapsObstacle(left, top, width, height, obstacle, clearance)) return { left, top }

  if (current.right <= obstacle.left - clearance + 1) {
    return { left: obstacle.left - clearance - width, top }
  }
  if (current.left >= obstacle.right + clearance - 1) {
    return { left: obstacle.right + clearance, top }
  }
  if (current.bottom <= obstacle.top - clearance + 1) {
    return { left, top: obstacle.top - clearance - height }
  }
  if (current.top >= obstacle.bottom + clearance - 1) {
    return { left, top: obstacle.bottom + clearance }
  }

  const candidates = [
    { left: obstacle.left - clearance - width, top },
    { left: obstacle.right + clearance, top },
    { left, top: obstacle.top - clearance - height },
    { left, top: obstacle.bottom + clearance },
  ]
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate.left - left) + Math.abs(candidate.top - top) <
    Math.abs(closest.left - left) + Math.abs(closest.top - top)
      ? candidate
      : closest,
  )
}

function clampToBoard(
  left: number,
  top: number,
  width: number,
  height: number,
  board: RectBounds,
  clearance: number,
): { left: number; top: number } {
  return {
    left: Math.min(board.right - clearance - width, Math.max(board.left + clearance, left)),
    top: Math.min(board.bottom - clearance - height, Math.max(board.top + clearance, top)),
  }
}

function initialFreePosition(index: number, count: number, isOwnTeam: boolean): FreePosition {
  const safeCount = Math.max(1, count)
  if (!isOwnTeam) {
    const leftCount = Math.ceil(safeCount / 2)
    const rightCount = safeCount - leftCount
    const x =
      index < leftCount
        ? 0.04 + ((index + 0.5) / leftCount) * 0.4
        : 0.56 + ((index - leftCount + 0.5) / Math.max(1, rightCount)) * 0.4
    return { x, y: 0.35 }
  }
  return { x: (index + 0.5) / safeCount, y: 0.55 }
}

function freePositionCandidates(isOwnTeam: boolean): FreePosition[] {
  const xs = [0.08, 0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.88, 0.95]
  const ys = isOwnTeam ? [0.55, 0.28, 0.78] : [0.35, 0.68, 0.16]
  return ys.flatMap((y) => xs.map((x) => ({ x, y })))
}

function isFreePosition(candidate: FreePosition, occupied: FreePosition[]): boolean {
  return occupied.every(
    (position) =>
      Math.abs(position.x - candidate.x) >= 0.1 || Math.abs(position.y - candidate.y) >= 0.28,
  )
}

function chooseInitialFreePosition(
  index: number,
  count: number,
  isOwnTeam: boolean,
  occupied: FreePosition[],
): FreePosition {
  const preferred = initialFreePosition(index, count, isOwnTeam)
  const candidates = [preferred, ...freePositionCandidates(isOwnTeam)]
  const available = candidates.find((candidate) => isFreePosition(candidate, occupied))
  if (available) return available

  return candidates.reduce((best, candidate) => {
    const nearestDistance = Math.min(
      ...occupied.map((position) =>
        Math.hypot((position.x - candidate.x) * 2, position.y - candidate.y),
      ),
    )
    const bestDistance = Math.min(
      ...occupied.map((position) => Math.hypot((position.x - best.x) * 2, position.y - best.y)),
    )
    return nearestDistance > bestDistance ? candidate : best
  }, preferred)
}

function seedFreePositions(
  melds: Meld[],
  isOwnTeam: boolean,
  current: Record<string, FreePosition>,
): Record<string, FreePosition> {
  const next: Record<string, FreePosition> = {}
  const occupied: FreePosition[] = []
  let changed = Object.keys(current).length !== melds.length

  melds.forEach((meld, index) => {
    const existing = current[meld.id]
    const position = existing ?? chooseInitialFreePosition(index, melds.length, isOwnTeam, occupied)
    next[meld.id] = position
    occupied.push(position)
    if (!existing) changed = true
  })

  return changed ? next : current
}

export function TeamZone({
  teamId,
  melds,
  isOwnTeam,
  canDragAdd,
  handCards = [],
  canStealFrom,
  highlightedTeamId,
  highlightedCardIds = [],
  highlightedMeldId,
}: TeamZoneProps) {
  const [expandedMeldIds, setExpandedMeldIds] = useState<Set<string>>(() => new Set())
  const [freePositions, setFreePositions] = useState<Record<string, FreePosition>>(() =>
    seedFreePositions(melds, isOwnTeam, {}),
  )
  const [frontmostMeldId, setFrontmostMeldId] = useState<string | null>(null)
  const [draggingMeldId, setDraggingMeldId] = useState<string | null>(null)
  const freeBoardRef = useRef<HTMLUListElement>(null)
  const freeDragRef = useRef<FreeDrag | null>(null)
  const suppressFreeClickRef = useRef<string | null>(null)
  const draggedHandCardId = useDragStore((state) => (state.origin === 'hand' ? state.cardId : null))

  useEffect(() => {
    return useDragStore.subscribe((state, previousState) => {
      const hoveredDropZone = state.hoveredZone
      if (!hoveredDropZone || hoveredDropZone === previousState.hoveredZone) return
      const hoveredMeldId = melds.find(
        ({ id }) => hoveredDropZone === `meld:${id}` || hoveredDropZone.startsWith(`wild:${id}:`),
      )?.id
      if (hoveredMeldId) setFrontmostMeldId(hoveredMeldId)
    })
  }, [melds])

  useLayoutEffect(() => {
    const board = freeBoardRef.current
    if (!board) return
    const boardRect = board.getBoundingClientRect()
    if (boardRect.width === 0 || boardRect.height === 0) return
    const obstacleRect = freeBoardObstacle(board, isOwnTeam)
    const clearance = 8

    setFreePositions((current) => {
      let next = seedFreePositions(melds, isOwnTeam, current)
      for (const { id: meldId } of melds) {
        const item = Array.from(board.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child.dataset.freeMeldId === meldId,
        )
        if (!item) continue
        const itemRect = item.getBoundingClientRect()
        const index = melds.findIndex((meld) => meld.id === meldId)
        const position = next[meldId] ?? initialFreePosition(index, melds.length, isOwnTeam)
        let corrected = clampToBoard(
          itemRect.left,
          itemRect.top,
          itemRect.width,
          itemRect.height,
          boardRect,
          clearance,
        )
        if (obstacleRect) {
          corrected = projectAlongObstacle(
            corrected.left,
            corrected.top,
            itemRect.width,
            itemRect.height,
            obstacleRect,
            itemRect,
            clearance,
          )
          corrected = clampToBoard(
            corrected.left,
            corrected.top,
            itemRect.width,
            itemRect.height,
            boardRect,
            clearance,
          )
        }
        const shiftX = corrected.left - itemRect.left
        const shiftY = corrected.top - itemRect.top

        if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
          if (next === current) next = { ...current }
          next[meldId] = {
            x: Math.min(1, Math.max(0, position.x + shiftX / boardRect.width)),
            y: Math.min(1, Math.max(0, position.y + shiftY / boardRect.height)),
          }
        }
      }
      return next
    })
  }, [expandedMeldIds, isOwnTeam, melds])

  function toggleCompactMeld(meldId: string) {
    setExpandedMeldIds((current) => {
      const next = new Set(current)
      if (next.has(meldId)) next.delete(meldId)
      else next.add(meldId)
      return next
    })
  }

  function defaultFreePosition(index: number): FreePosition {
    return chooseInitialFreePosition(index, melds.length, isOwnTeam, Object.values(freePositions))
  }

  function startFreeDrag(event: ReactPointerEvent<HTMLLIElement>, meldId: string) {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    freeDragRef.current = {
      meldId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    }
    setFrontmostMeldId(meldId)
  }

  const moveFreeMeld = useCallback(
    (clientX: number, clientY: number) => {
      const drag = freeDragRef.current
      const board = freeBoardRef.current
      if (!drag || !board) return
      const item = board.querySelector<HTMLElement>(`[data-free-meld-id="${drag.meldId}"]`)
      if (!item) return
      const boardRect = board.getBoundingClientRect()
      const itemRect = item.getBoundingClientRect()
      const clearance = 8
      let position = clampToBoard(
        clientX - drag.offsetX,
        clientY - drag.offsetY,
        itemRect.width,
        itemRect.height,
        boardRect,
        clearance,
      )
      const obstacleRect = freeBoardObstacle(board, isOwnTeam)
      if (obstacleRect) {
        position = projectAlongObstacle(
          position.left,
          position.top,
          itemRect.width,
          itemRect.height,
          obstacleRect,
          itemRect,
          clearance,
        )
        position = clampToBoard(
          position.left,
          position.top,
          itemRect.width,
          itemRect.height,
          boardRect,
          clearance,
        )
      }
      setFreePositions((current) => ({
        ...current,
        [drag.meldId]: {
          x: (position.left - boardRect.left + itemRect.width / 2) / boardRect.width,
          y: (position.top - boardRect.top + itemRect.height / 2) / boardRect.height,
        },
      }))
    },
    [isOwnTeam],
  )

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = freeDragRef.current
      if (!drag) return
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return
        drag.active = true
        setDraggingMeldId(drag.meldId)
      }
      event.preventDefault()
      moveFreeMeld(event.clientX, event.clientY)
    }

    function stopFreeDrag() {
      const drag = freeDragRef.current
      if (drag?.active) suppressFreeClickRef.current = drag.meldId
      freeDragRef.current = null
      setDraggingMeldId(null)
    }

    document.addEventListener('pointermove', handlePointerMove, { passive: false })
    document.addEventListener('pointerup', stopFreeDrag)
    document.addEventListener('pointercancel', stopFreeDrag)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopFreeDrag)
      document.removeEventListener('pointercancel', stopFreeDrag)
    }
  }, [moveFreeMeld])

  return (
    <div
      aria-label={`melds-${teamId}`}
      data-team-id={teamId}
      className={`team-zone ${isOwnTeam ? 'team-zone-bottom' : 'team-zone-top'}${
        highlightedTeamId === teamId ? ' is-recent-action' : ''
      }`}
    >
      <div className="team-zone-heading">
        <h3 className="team-zone-title">
          {isOwnTeam ? 'Ваши комбинации' : 'Комбинации соперников'}
        </h3>
      </div>
      <div className="team-zone-fit">
        {melds.length > 0 && (
          <div className="team-zone-shell">
            <div className="team-zone-strip">
              <ul ref={freeBoardRef} className="meld-row free-meld-board">
                {melds.map((meld, index) => {
                  const compact = !expandedMeldIds.has(meld.id)
                  const freePosition = freePositions[meld.id] ?? defaultFreePosition(index)
                  const draggedCard = handCards.find((card) => card.id === draggedHandCardId)
                  const canDropCard =
                    canDragAdd === true &&
                    draggedCard !== undefined &&
                    canAddCardToMeld(meld, draggedCard)
                  return (
                    <li
                      key={meld.id}
                      data-free-meld-id={meld.id}
                      className={
                        `${!compact ? 'is-expanded ' : ''}${
                          frontmostMeldId === meld.id ? 'is-frontmost' : ''
                        }${draggingMeldId === meld.id ? ' is-dragging' : ''}`.trim() || undefined
                      }
                      onPointerDownCapture={() => setFrontmostMeldId(meld.id)}
                      onFocusCapture={() => setFrontmostMeldId(meld.id)}
                      onPointerDown={(event) => startFreeDrag(event, meld.id)}
                      onClickCapture={(event) => {
                        if (suppressFreeClickRef.current !== meld.id) return
                        suppressFreeClickRef.current = null
                        event.preventDefault()
                        event.stopPropagation()
                      }}
                      style={
                        {
                          '--free-y': `${freePosition.y * 100}%`,
                          '--free-x': `${freePosition.x * 100}%`,
                        } as CSSProperties
                      }
                    >
                      <MeldStack
                        meld={meld}
                        isOwnTeam={isOwnTeam}
                        canDragAdd={canDragAdd}
                        canDropCard={canDropCard}
                        canStealFrom={canStealFrom}
                        compact={compact}
                        stackCompact
                        onToggleCompact={() => toggleCompactMeld(meld.id)}
                        highlightedCardIds={highlightedCardIds}
                        isRecentAction={highlightedMeldId === meld.id}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
