// Small, dependency-free linear algebra for Step 52's MMM — a multiple linear
// regression needs to solve a (k+1)x(k+1) normal-equations system where k is the
// number of ad platforms a client uses (almost always under 10), far too small to
// justify pulling in a numeric library for.

export function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 0
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      result[j][i] = matrix[i][j]
    }
  }
  return result
}

export function multiply(a: number[][], b: number[][]): number[][] {
  const result: number[][] = Array.from({ length: a.length }, () => new Array(b[0].length).fill(0))
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0
      for (let k = 0; k < b.length; k++) sum += a[i][k] * b[k][j]
      result[i][j] = sum
    }
  }
  return result
}

export function multiplyVector(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((sum, val, i) => sum + val * v[i], 0))
}

// Gaussian elimination with partial pivoting. Throws on a singular matrix
// (perfectly collinear columns — e.g. two ad platforms whose spend always moves
// in exact lockstep) rather than returning a garbage answer.
export function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = matrix.length
  const A = matrix.map((row) => [...row])
  const b = [...vector]

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(A[pivotRow][col]) < 1e-10) {
      throw new Error('Matrix is singular or near-singular — likely two inputs are too collinear to separate')
    }
    if (pivotRow !== col) {
      ;[A[col], A[pivotRow]] = [A[pivotRow], A[col]]
      ;[b[col], b[pivotRow]] = [b[pivotRow], b[col]]
    }
    for (let row = col + 1; row < n; row++) {
      const factor = A[row][col] / A[col][col]
      for (let k = col; k < n; k++) A[row][k] -= factor * A[col][k]
      b[row] -= factor * b[col]
    }
  }

  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row]
    for (let col = row + 1; col < n; col++) sum -= A[row][col] * x[col]
    x[row] = sum / A[row][row]
  }
  return x
}

// Ordinary least squares via the normal equations: beta = (X^T X)^-1 X^T y.
// X's first column should be all 1s (the intercept term).
export function fitMultipleRegression(X: number[][], y: number[]): number[] {
  const Xt = transpose(X)
  const XtX = multiply(Xt, X)
  const Xty = multiplyVector(Xt, y)
  return solveLinearSystem(XtX, Xty)
}

// R-squared — how much of the variance in y the fitted model actually explains.
// Reported alongside every MMM result so a low-confidence fit (too little data,
// too little spend variance) is visible, not hidden behind a confident-looking number.
export function rSquared(X: number[][], y: number[], beta: number[]): number {
  const predicted = X.map((row) => row.reduce((sum, val, i) => sum + val * beta[i], 0))
  const meanY = y.reduce((a, b) => a + b, 0) / y.length
  const ssRes = y.reduce((sum, yi, i) => sum + (yi - predicted[i]) ** 2, 0)
  const ssTot = y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0)
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot
}
