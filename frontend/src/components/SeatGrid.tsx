import { useState } from 'react'
import { Handshake, Swords, UsersRound } from 'lucide-react'
import type { LobbyPlayer } from '../lib/protocol'
import { SeatAssignModal } from './SeatAssignModal'

type TeamId = 'A' | 'B'

const TEAM_SEATS: Record<TeamId, readonly number[]> = {
  A: [0, 2],
  B: [1, 3],
}

interface SeatGridProps {
  players: LobbyPlayer[]
  viewerId: string | null
  hostId: string | null
  isHost: boolean
  onAssignSeat: (playerId: string, seat: number) => void
  onAddBot: (seat: number) => void
  onRemovePlayer: (playerId: string) => void
}

function statusLabel(player: LobbyPlayer): string {
  if (player.is_bot) return 'бот'
  return player.connected ? 'в сети' : 'офлайн'
}

function playerTeam(player: LobbyPlayer | undefined): TeamId | null {
  if (!player) return null
  if (player.team_id === 'A' || player.team_id === 'B') return player.team_id
  if (player.seat === null) return null
  return player.seat % 2 === 0 ? 'A' : 'B'
}

export function SeatGrid({
  players,
  viewerId,
  hostId,
  isHost,
  onAssignSeat,
  onAddBot,
  onRemovePlayer,
}: SeatGridProps) {
  const [assignSeat, setAssignSeat] = useState<number | null>(null)
  const bySeat = new Map(players.filter((p) => p.seat !== null).map((p) => [p.seat, p]))
  const unseated = players.filter((p) => p.seat === null)
  const viewerTeam = playerTeam(players.find((player) => player.id === viewerId))
  const teamOrder: TeamId[] = viewerTeam ? [viewerTeam, viewerTeam === 'A' ? 'B' : 'A'] : ['A', 'B']

  const seatRole = (seat: number, player: LobbyPlayer | undefined, team: TeamId): string => {
    if (!viewerTeam) return `Место ${seat + 1}`
    if (player?.id === viewerId) return 'Вы'
    return team === viewerTeam ? 'Напарник' : 'Соперник'
  }

  return (
    <div>
      <div aria-label="seats" className="seat-grid">
        {teamOrder.map((team) => {
          const isViewerTeam = viewerTeam === team
          const title = viewerTeam
            ? isViewerTeam
              ? 'Ваша команда'
              : 'Команда соперников'
            : `Команда ${team}`
          const TeamIcon = viewerTeam ? (isViewerTeam ? Handshake : Swords) : UsersRound

          return (
            <section
              key={team}
              className={`lobby-team${isViewerTeam ? ' is-viewer-team' : ' is-opponent-team'}`}
              aria-label={title}
            >
              <h3 className="lobby-team-title">
                <TeamIcon aria-hidden="true" />
                {title}
              </h3>
              <ul className="lobby-team-seats">
                {TEAM_SEATS[team].map((seat) => {
                  const player = bySeat.get(seat)
                  return (
                    <li
                      key={seat}
                      data-seat={seat}
                      className={`seat-card${player ? ' is-filled' : ''}`}
                    >
                      <span className="seat-label">{seatRole(seat, player, team)}</span>
                      {player ? (
                        <>
                          <span className="seat-player-name">{player.name}</span>
                          <span className="seat-player-meta">
                            {player.id === hostId && <span className="host-tag">хост</span>}
                            <span
                              className={`online-tag ${
                                player.is_bot
                                  ? 'is-bot'
                                  : player.connected
                                    ? 'is-online'
                                    : 'is-offline'
                              }`}
                            >
                              {statusLabel(player)}
                            </span>
                          </span>
                          {isHost && (
                            <span className="seat-player-actions">
                              <button
                                type="button"
                                className="btn btn-ghost seat-change-btn"
                                onClick={() => setAssignSeat(seat)}
                              >
                                Сменить
                              </button>
                              {player.id !== hostId && (
                                <button
                                  type="button"
                                  className="btn btn-ghost seat-remove-btn"
                                  aria-label={`Выгнать ${player.name}`}
                                  onClick={() => onRemovePlayer(player.id)}
                                >
                                  Выгнать
                                </button>
                              )}
                            </span>
                          )}
                        </>
                      ) : isHost ? (
                        <button
                          type="button"
                          className="btn seat-open-btn"
                          onClick={() => setAssignSeat(seat)}
                        >
                          Назначить
                        </button>
                      ) : (
                        <span className="seat-free-label">свободно</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      {unseated.length > 0 && (
        <ul aria-label="unseated" className="unseated-list">
          {unseated.map((player) => (
            <li key={player.id} className="unseated-chip">
              <span>
                {player.name}
                {player.id === hostId ? ' · хост' : ''}
                {' · '}
                {statusLabel(player)}
              </span>
              {isHost && player.id !== hostId && (
                <button
                  type="button"
                  className="btn btn-ghost seat-remove-btn"
                  aria-label={`Выгнать ${player.name}`}
                  onClick={() => onRemovePlayer(player.id)}
                >
                  Выгнать
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {assignSeat !== null && (
        <SeatAssignModal
          seat={assignSeat}
          players={players}
          onAssign={(playerId) => onAssignSeat(playerId, assignSeat)}
          onAddBot={() => {
            onAddBot(assignSeat)
            setAssignSeat(null)
          }}
          onClose={() => setAssignSeat(null)}
        />
      )}
    </div>
  )
}
