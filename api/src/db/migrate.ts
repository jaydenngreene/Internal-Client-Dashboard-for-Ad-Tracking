import { db } from './index'
import * as fs from 'fs'
import * as path from 'path'

async function migrate() {
  const migrationsDir = path.join(__dirname, '../../migrations')
  const files = fs.readdirSync(migrationsDir).sort()

  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  for (const file of files) {
    if (!file.endsWith('.sql')) continue

    const { rows } = await db.query(
      'SELECT id FROM _migrations WHERE filename = $1',
      [file]
    )
    if (rows.length > 0) {
      console.log(`Skipping ${file} (already run)`)
      continue
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    await db.query(sql)
    await db.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
    console.log(`Ran migration: ${file}`)
  }

  await db.end()
  console.log('Migrations complete')
}

migrate().catch((err) => {
  console.error('Migration failed', err)
  process.exit(1)
})
