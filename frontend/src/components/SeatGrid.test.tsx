import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SeatGrid } from './SeatGrid'
import type { LobbyPlayer } from '../lib/protocol'

function player(overrides: Partial<LobbyPlayer>): LobbyPlayer {
  return {
    id: 'p1',
    name: 'Alice',
    seat: null,
    team_id: null,
    connected: true,
    is_host: false,
    is_bot: false,
    ...overrides,
  }
}

describe('SeatGrid', () => {
  it('shows an empty seat as free for a non-host viewer', () => {
    render(
      <SeatGrid
        players={[]}
        viewerId={null}
        hostId={null}
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )
    expect(screen.getAllByText(/свободно/)).toHaveLength(4)
  })

  it('places a seated player in their seat and marks the host', () => {
    const alice = player({ id: 'p1', name: 'Alice', seat: 0, is_host: true })
    render(
      <SeatGrid
        players={[alice]}
        viewerId="p1"
        hostId="p1"
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('хост')).toBeInTheDocument()
    expect(screen.getAllByText(/свободно/)).toHaveLength(3)
  })

  it('lists joined players who have not been assigned a seat yet', () => {
    const bob = player({ id: 'p2', name: 'Bob', seat: null, connected: false })
    render(
      <SeatGrid
        players={[bob]}
        viewerId={null}
        hostId="p1"
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    expect(screen.getByText(/Bob · офлайн/)).toBeInTheDocument()
  })

  it('lets the host assign an unseated player via modal', async () => {
    const alice = player({ id: 'p1', name: 'Alice', seat: 0, is_host: true })
    const bob = player({ id: 'p2', name: 'Bob', seat: null })
    const onAssignSeat = vi.fn()
    render(
      <SeatGrid
        players={[alice, bob]}
        viewerId="p1"
        hostId="p1"
        isHost
        onAssignSeat={onAssignSeat}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    await userEvent.click(
      within(screen.getByRole('region', { name: 'Команда соперников' })).getAllByText(
        'Назначить',
      )[0],
    )
    await userEvent.click(screen.getByRole('button', { name: 'Bob' }))

    expect(onAssignSeat).toHaveBeenCalledWith('p2', 1)
  })

  it('lets the host replace an occupied seat', async () => {
    const alice = player({ id: 'p1', name: 'Alice', seat: 0, is_host: true })
    const bob = player({ id: 'p2', name: 'Bob', seat: 1 })
    const onAssignSeat = vi.fn()
    render(
      <SeatGrid
        players={[alice, bob]}
        viewerId="p1"
        hostId="p1"
        isHost
        onAssignSeat={onAssignSeat}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    await userEvent.click(screen.getAllByText('Сменить')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Bobместо 2' }))

    expect(onAssignSeat).toHaveBeenCalledWith('p2', 0)
  })

  it('does not offer seat assignment controls to non-host viewers', () => {
    render(
      <SeatGrid
        players={[]}
        viewerId={null}
        hostId="p1"
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )
    expect(screen.queryByText('Назначить')).not.toBeInTheDocument()
    expect(screen.queryByText(/Добавить бота/)).not.toBeInTheDocument()
    expect(screen.queryByText('Выгнать')).not.toBeInTheDocument()
  })

  it('lets the host add a bot from the assign modal', async () => {
    const onAddBot = vi.fn()
    render(
      <SeatGrid
        players={[]}
        viewerId={null}
        hostId="p1"
        isHost
        onAssignSeat={vi.fn()}
        onAddBot={onAddBot}
        onRemovePlayer={vi.fn()}
      />,
    )

    await userEvent.click(
      within(screen.getByRole('region', { name: 'Команда B' })).getAllByText('Назначить')[0],
    )
    await userEvent.click(screen.getByRole('button', { name: 'Добавить бота' }))
    expect(onAddBot).toHaveBeenCalledWith(1)
  })

  it('shows bot status without emoji', () => {
    const bot = player({ id: 'p3', name: 'Бот 2', seat: 1, is_bot: true, connected: true })
    render(
      <SeatGrid
        players={[bot]}
        viewerId={null}
        hostId="p1"
        isHost
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    expect(screen.getByText('бот')).toBeInTheDocument()
    expect(screen.queryByText(/🤖/)).not.toBeInTheDocument()
  })

  it('lets the host remove both human players and bots, but not themselves', async () => {
    const alice = player({ id: 'p1', name: 'Alice', seat: 0, is_host: true })
    const bob = player({ id: 'p2', name: 'Bob', seat: 1 })
    const bot = player({ id: 'p3', name: 'Morgan', seat: 2, is_bot: true })
    const onRemovePlayer = vi.fn()
    render(
      <SeatGrid
        players={[alice, bob, bot]}
        viewerId="p1"
        hostId="p1"
        isHost
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={onRemovePlayer}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Выгнать Alice' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Выгнать Bob' }))
    await userEvent.click(screen.getByRole('button', { name: 'Выгнать Morgan' }))

    expect(onRemovePlayer).toHaveBeenNthCalledWith(1, 'p2')
    expect(onRemovePlayer).toHaveBeenNthCalledWith(2, 'p3')
  })

  it('lets the host remove an unseated player', async () => {
    const bob = player({ id: 'p2', name: 'Bob', seat: null })
    const onRemovePlayer = vi.fn()
    render(
      <SeatGrid
        players={[bob]}
        viewerId={null}
        hostId="p1"
        isHost
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={onRemovePlayer}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Выгнать Bob' }))
    expect(onRemovePlayer).toHaveBeenCalledWith('p2')
  })

  it('groups teammates together and labels teams relative to the viewer', () => {
    const alice = player({ id: 'p1', name: 'Alice', seat: 0, team_id: 'A' })
    const partner = player({ id: 'p3', name: 'Carol', seat: 2, team_id: 'A' })
    const opponent = player({ id: 'p2', name: 'Bob', seat: 1, team_id: 'B' })
    render(
      <SeatGrid
        players={[alice, opponent, partner]}
        viewerId="p1"
        hostId="p1"
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    const ownTeam = screen.getByRole('region', { name: 'Ваша команда' })
    const opponents = screen.getByRole('region', { name: 'Команда соперников' })
    expect(ownTeam).toHaveTextContent('Вы')
    expect(ownTeam).toHaveTextContent('Alice')
    expect(ownTeam).toHaveTextContent('Напарник')
    expect(ownTeam).toHaveTextContent('Carol')
    expect(opponents).toHaveTextContent('Соперник')
    expect(opponents).toHaveTextContent('Bob')
  })

  it('uses neutral team names before the viewer takes a seat', () => {
    render(
      <SeatGrid
        players={[]}
        viewerId={null}
        hostId={null}
        isHost={false}
        onAssignSeat={vi.fn()}
        onAddBot={vi.fn()}
        onRemovePlayer={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Команда A' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Команда B' })).toBeInTheDocument()
  })
})
