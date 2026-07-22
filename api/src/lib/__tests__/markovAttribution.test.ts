import { describe, it, expect } from 'vitest'
import { buildTransitionCounts, solveAbsorptionProbabilities, START } from '../markovAttribution'

describe('markov removal-effect attribution', () => {
  // Hand-calculable scenario: ChannelA visitors always convert, ChannelB visitors
  // never do. Removing ChannelA should destroy all conversion probability
  // (removal effect 1.0); removing ChannelB should change nothing (0.0), since
  // it never contributed to a conversion in the first place.
  const paths = [
    { channels: ['ChannelA'], converted: true },
    { channels: ['ChannelA'], converted: true },
    { channels: ['ChannelB'], converted: false },
    { channels: ['ChannelB'], converted: false },
  ]

  it('computes the correct baseline conversion probability', () => {
    const counts = buildTransitionCounts(paths)
    const p = solveAbsorptionProbabilities(counts, [START, 'ChannelA', 'ChannelB'])
    // Half of visitors go to ChannelA (100% convert), half to ChannelB (0% convert)
    expect(p).toBeCloseTo(0.5, 10)
  })

  it('gives ChannelA a removal effect of exactly 1.0 (removing it kills all conversions)', () => {
    const counts = buildTransitionCounts(paths)
    const full = solveAbsorptionProbabilities(counts, [START, 'ChannelA', 'ChannelB'])
    const withoutA = solveAbsorptionProbabilities(counts, [START, 'ChannelB'])
    expect(withoutA).toBeCloseTo(0, 10)
    expect((full - withoutA) / full).toBeCloseTo(1.0, 10)
  })

  it('gives ChannelB a removal effect of exactly 0.0 (it never led to a conversion)', () => {
    const counts = buildTransitionCounts(paths)
    const full = solveAbsorptionProbabilities(counts, [START, 'ChannelA', 'ChannelB'])
    const withoutB = solveAbsorptionProbabilities(counts, [START, 'ChannelA'])
    expect((full - withoutB) / full).toBeCloseTo(0, 10)
  })

  it('handles a multi-touch path correctly (credit reaches conversion through an intermediate channel)', () => {
    const multiTouchPaths = [
      { channels: ['ChannelA', 'ChannelB'], converted: true },
      { channels: ['ChannelA', 'ChannelB'], converted: true },
      { channels: ['ChannelA'], converted: false },
      { channels: ['ChannelA'], converted: false },
    ]
    const counts = buildTransitionCounts(multiTouchPaths)
    const full = solveAbsorptionProbabilities(counts, [START, 'ChannelA', 'ChannelB'])
    // All 4 visitors start at ChannelA (so START->A carries all conversion potential);
    // exactly half of ChannelA's visitors also go on to ChannelB and convert.
    expect(full).toBeCloseTo(0.5, 10)
    const withoutB = solveAbsorptionProbabilities(counts, [START, 'ChannelA'])
    // Without ChannelB, the two visitors who needed it can never convert.
    expect(withoutB).toBeCloseTo(0, 10)
  })
})
