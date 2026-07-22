import { describe, it, expect } from 'vitest'
import { solveLinearSystem, fitMultipleRegression, rSquared, transpose, multiply } from '../linearAlgebra'

describe('solveLinearSystem', () => {
  it('solves a simple 2x2 system', () => {
    // 2x + y = 5, x + 3y = 10 -> x=1, y=3
    const result = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10]
    )
    expect(result[0]).toBeCloseTo(1, 8)
    expect(result[1]).toBeCloseTo(3, 8)
  })

  it('throws on a singular matrix', () => {
    expect(() =>
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6]
      )
    ).toThrow(/singular/)
  })
})

describe('transpose / multiply', () => {
  it('transposes correctly', () => {
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ])
  })

  it('multiplies matrices correctly', () => {
    const result = multiply(
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ]
    )
    expect(result).toEqual([
      [19, 22],
      [43, 50],
    ])
  })
})

describe('fitMultipleRegression + rSquared', () => {
  it('recovers exact coefficients from noiseless linear data', () => {
    // y = 10 + 2*x1 + 3*x2, no noise
    const X = [
      [1, 1, 1],
      [1, 2, 1],
      [1, 1, 2],
      [1, 3, 2],
      [1, 2, 3],
    ]
    const y = X.map((row) => 10 + 2 * row[1] + 3 * row[2])
    const beta = fitMultipleRegression(X, y)
    expect(beta[0]).toBeCloseTo(10, 6)
    expect(beta[1]).toBeCloseTo(2, 6)
    expect(beta[2]).toBeCloseTo(3, 6)

    const r2 = rSquared(X, y, beta)
    expect(r2).toBeCloseTo(1, 6) // perfect fit, no noise
  })

  it('reports a lower R-squared for noisy/imperfect data', () => {
    const X = [
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ]
    // Roughly y = 5 + x but with real noise
    const y = [6, 6.5, 9, 8.5]
    const beta = fitMultipleRegression(X, y)
    const r2 = rSquared(X, y, beta)
    expect(r2).toBeGreaterThan(0)
    expect(r2).toBeLessThan(1)
  })
})
