import * as readline from 'readline'
import * as path from 'path'
import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import { Pool } from 'pg'
import * as bcrypt from 'bcryptjs'

dotenv.config({ path: path.join(__dirname, '../.env') })

const db = new Pool({ connectionString: process.env.DATABASE_URL })

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())))

function box(title: string, lines: string[]) {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4
  const hr = '─'.repeat(width)
  console.log(`\n┌${hr}┐`)
  console.log(`│  ${title.padEnd(width - 2)}│`)
  console.log(`├${hr}┤`)
  lines.forEach((l) => console.log(`│  ${l.padEnd(width - 2)}│`))
  console.log(`└${hr}┘`)
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Not user-chosen, so a fast random value is fine here (same reasoning as
// lib/auth.ts's generateRandomToken) — this becomes a one-time password the new
// user is expected to change from Account Settings after their first login.
function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12)
}

// The only way left to create a dashboard login — public self-registration was
// removed from both the API and the login page on purpose. Writes directly to the
// users table (same pattern as scripts/setup-*.ts talking straight to Postgres),
// hashing the password with the exact same bcrypt cost factor auth.ts's own
// hashPassword uses so a login created here behaves identically to one that would
// have come through the old register endpoint. email_verified is set true
// immediately — an admin personally creating this account already vouches for the
// address, there's no reason to make them click a verification email too.
async function main() {
  console.log('\n👤  Create a dashboard login\n')
  console.log('Public self-registration has been removed — this script is now the only way to create one.\n')

  const email = (await ask('Email: ')).toLowerCase().trim()
  if (!email || !isValidEmail(email)) {
    console.log('A valid email is required.')
    process.exit(1)
  }

  const { rows: existing } = await db.query('SELECT id FROM users WHERE email = $1', [email])
  if (existing.length > 0) {
    console.log(`An account with ${email} already exists.`)
    process.exit(1)
  }

  const agencyName = await ask('Agency / workspace name: ')
  if (!agencyName) {
    console.log('An agency/workspace name is required.')
    process.exit(1)
  }

  const typedPassword = await ask('Password (leave blank to generate a secure one): ')
  const generated = !typedPassword
  const password = generated ? generateTempPassword() : typedPassword
  if (password.length < 8) {
    console.log('Password must be at least 8 characters.')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await db.query(
    `INSERT INTO users (email, password_hash, agency_name, email_verified)
     VALUES ($1, $2, $3, true)`,
    [email, passwordHash, agencyName]
  )

  box('Login created', [
    `Email:    ${email}`,
    `Password: ${password}`,
    `Agency:   ${agencyName}`,
  ])
  console.log(
    generated
      ? '\nThis password was generated - send it to them securely. They can change it from Account Settings after logging in.\n'
      : '\nGive these credentials to the user. They can change the password from Account Settings after logging in.\n'
  )

  await db.end()
  rl.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
