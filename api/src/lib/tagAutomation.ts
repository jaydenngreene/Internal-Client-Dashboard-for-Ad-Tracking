import { db } from '../db'
import { recordPurchase } from './attribution'

interface TagRow {
  id: string
  name: string
  tag_type: string
  product_value: string | null
}

// Applying a 'product'-type tag to a lead auto-generates a Sale — reuses the
// existing recordPurchase() pipeline directly (attribution, LTV, conversion
// signals) rather than a second parallel path. Wrapped so a misconfigured tag
// (e.g. no product_value) never blocks the tag-apply itself, same never-block
// philosophy as every other automation in this app.
export async function applyTagAndAutomate(clientId: string, email: string, tagId: string): Promise<void> {
  const { rows } = await db.query<TagRow>(`SELECT id, name, tag_type, product_value FROM tags WHERE id = $1 AND client_id = $2`, [
    tagId,
    clientId,
  ])
  const tag = rows[0]
  if (!tag) throw new Error('Tag not found')

  // Hyros's own documented behavior: a tag-matching-a-product only generates a sale
  // "if it didn't already have the tag" — so the auto-sale only fires when this
  // INSERT actually adds a new row, not on a repeat application of a tag the lead
  // already has.
  const { rows: insertedRows } = await db.query(
    `INSERT INTO lead_tags (client_id, email, tag_id) VALUES ($1, $2, $3)
     ON CONFLICT (client_id, email, tag_id) DO NOTHING
     RETURNING id`,
    [clientId, email, tagId]
  )
  const isNewApplication = insertedRows.length > 0

  if (isNewApplication && tag.tag_type === 'product' && tag.product_value) {
    try {
      await recordPurchase(clientId, {
        email,
        revenue: parseFloat(tag.product_value),
        product: tag.name,
        order_id: null,
        processor: 'tag',
      })
    } catch (err) {
      console.error(`[tagAutomation] auto-sale failed for client=${clientId} tag=${tag.name}:`, (err as Error).message)
    }
  }
}
