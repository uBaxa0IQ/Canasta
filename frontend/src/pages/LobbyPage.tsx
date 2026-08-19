import { useParams } from 'react-router-dom'
import { LobbySettingsPanel } from '../components/LobbySettingsPanel'
import { SeatGrid } from '../components/SeatGrid'
import { useConnectionStore } from '../stores/connectionStore'
import { useLobbyStore } from '../stores/lobbyStore'

const REQUIRED_SEATS = 4

export function LobbyPage() {
  const { gameId = '' } = useParams()
  const send = useConnectionStore((s) => s.send)
  const status = useConnectionStore((s) => s.status)
  const playerId = useConnectionStore((s) => s.playerId)
  const players = useLobbyStore((s) => s.players)
  const hostId = useLobbyStore((s) => s.hostId)
  const settings = useLobbyStore((s) => s.settings)

  const inviteLink = `${window.location.origin}/join/${gameId}`
  const isHost = playerId !== null && playerId === hostId
  const seatedCount = players.filter((p) => p.seat !== null).length
  const canStart = isHost && seatedCount === REQUIRED_SEATS

  const statusDotClass =
    status === 'open'
      ? 'is-open'
      : status === 'connecting'
        ? 'is-connecting'
        : status === 'closed' || status === 'error'
          ? 'is-closed'
          : ''

  return (
    <main className="page-shell">
      <div className="panel" style={{ width: 'min(640px, 100%)' }}>
        <h1 className="brand-title">Лобби</h1>
        <p className="status-line">
          <span className={`status-dot ${statusDotClass}`} />
          Статус соединения: {status}
        </p>

        <div className="invite-row">
          <span>Ссылка для друзей:</span>
          <code className="invite-code">{inviteLink}</code>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigator.clipboard.writeText(inviteLink)}
          >
            Скопировать
          </button>
        </div>

        <h2>Команды</h2>
        <SeatGrid
          players={players}
          viewerId={playerId}
          hostId={hostId}
          isHost={isHost}
          onAssignSeat={(assignedPlayerId, seat) =>
            send('assign_seat', { player_id: assignedPlayerId, seat })
          }
          onAddBot={(seat) => send('add_bot', { seat })}
          onRemovePlayer={(removedPlayerId) =>
            send('remove_player', { player_id: removedPlayerId })
          }
        />

        <h2>Настройки</h2>
        <LobbySettingsPanel
          targetScore={settings.targetScore}
          discardVisibility={settings.discardVisibility}
          isHost={isHost}
          onChange={(change) => send('set_lobby_settings', change)}
        />

        {isHost && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canStart}
            onClick={() => send('start_game', {})}
          >
            Начать игру
          </button>
        )}
      </div>
    </main>
  )
}
