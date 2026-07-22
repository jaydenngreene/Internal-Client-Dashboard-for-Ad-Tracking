// lib/auth.ts reads JWT_SECRET from process.env at module-load time, so it must
// be set before any test imports that module — a real .env is never loaded here
// on purpose, this is a fixed test-only value, never used outside this suite.
process.env.JWT_SECRET = 'vitest-test-secret-do-not-use-in-real-env'
