import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThresholdIndicator } from './ThresholdIndicator'

describe('ThresholdIndicator', () => {
  it('shows progress while the team is not yet opened', () => {
    render(<ThresholdIndicator teamId="A" accumulated={15} threshold={30} />)
    expect(screen.getByText('Выход: 15 из 30 очков')).toBeInTheDocument()
  })

  it('hides once accumulated points reach the threshold', () => {
    render(<ThresholdIndicator teamId="A" accumulated={30} threshold={30} />)
    expect(screen.queryByLabelText('threshold-A')).not.toBeInTheDocument()
  })

  it('stays hidden past the threshold too', () => {
    render(<ThresholdIndicator teamId="A" accumulated={45} threshold={30} />)
    expect(screen.queryByLabelText('threshold-A')).not.toBeInTheDocument()
  })

  it('shows a full preview while selected cards reach the threshold', () => {
    render(<ThresholdIndicator teamId="A" accumulated={35} threshold={30} previewing />)
    expect(screen.getByText('Выход: 35 из 30 очков')).toBeInTheDocument()
  })
})
