import { Pool } from 'pg'
import * as dotenv from 'dotenv'

dotenv.config()

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

db.on('error', (err) => {
  console.error('Unexpected DB error', err)
})
