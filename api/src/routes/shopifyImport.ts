import { FastifyInstance } from 'fastify'
import { parse } from 'csv-parse/sync'
import { recordPurchase, recordRefund } from '../lib/attribution'

const MAX_ERRORS_RETURNED = 20

// Shopify's order export puts one row per LINE ITEM, not per order — a 3-item
// order is 3 rows, and only the first row of each group carries the order-level
// fields (Email, Total, Created at, Financial Status, Id); the rest are blank
// there. Grouping by "Name" (the human order number, e.g. "#1001") and taking
// whichever row in the group actually has each field reconstructs one row per
// order, matching what routes/webhooks/shopify.ts sees from a live order.
interface OrderAgg {
  id: string
  name: string
  email: string
  total: string
  currency: string
  financialStatus: string
  cancelledAt: string
  refundedAmount: string
}

function groupOrders(rows: Record<string, string>[]): Map<string, OrderAgg> {
  const orders = new Map<string, OrderAgg>()
  for (const row of rows) {
    const name = row['Name']?.trim()
    if (!name) continue
    let order = orders.get(name)
    if (!order) {
      order = { id: '', name, email: '', total: '', currency: '', financialStatus: '', cancelledAt: '', refundedAmount: '' }
      orders.set(name, order)
    }
    if (row['Id']?.trim()) order.id = row['Id'].trim()
    if (row['Email']?.trim()) order.email = row['Email'].trim()
    if (row['Total']?.trim()) order.total = row['Total'].trim()
    if (row['Currency']?.trim()) order.currency = row['Currency'].trim()
    if (row['Financial Status']?.trim()) order.financialStatus = row['Financial Status'].trim()
    if (row['Cancelled at']?.trim()) order.cancelledAt = row['Cancelled at'].trim()
    if (row['Refunded Amount']?.trim()) order.refundedAmount = row['Refunded Amount'].trim()
  }
  return orders
}

export async function shopifyImportRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/clients/:id/shopify-import', async (req, reply) => {
    const { id: clientId } = req.params

    const file = await req.file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    if (!file.filename.toLowerCase().endsWith('.csv')) {
      return reply.code(400).send({ error: 'Expected a .csv file — export orders from Shopify Admin → Orders → Export' })
    }
    const buffer = await file.toBuffer()

    let rawRows: Record<string, string>[]
    try {
      rawRows = parse(buffer, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true })
    } catch (err) {
      return reply.code(400).send({ error: `Could not read this CSV: ${(err as Error).message}` })
    }
    if (rawRows.length === 0 || !('Name' in rawRows[0])) {
      return reply.code(400).send({
        error: 'This doesn\'t look like a Shopify order export — expected a "Name" column. Use Shopify Admin → Orders → Export.',
      })
    }

    const orders = groupOrders(rawRows)

    let imported = 0
    let skipped = 0
    let refundsApplied = 0
    const errors: string[] = []

    for (const order of orders.values()) {
      try {
        const status = order.financialStatus.toLowerCase()
        // Cancelled, voided, or fully refunded orders carry no net revenue — same
        // "skip, don't record a zero" rule the live webhook already applies.
        if (order.cancelledAt || status === 'voided' || status === 'refunded') {
          skipped++
          continue
        }
        if (!order.email) {
          skipped++
          continue
        }
        const total = parseFloat(order.total)
        if (!total) {
          skipped++
          continue
        }
        // Prefer Shopify's numeric order Id (same value the live webhook uses as
        // order_id) so a date range that overlaps with when the webhook went live
        // can never double-import the same order; the "#1001" Name is a fallback
        // for older exports that omit the Id column.
        const orderId = order.id || order.name.replace(/^#/, '')

        const wasNew = await recordPurchase(clientId, {
          email: order.email,
          revenue: total,
          product: null,
          order_id: orderId,
          processor: 'shopify',
          currency: order.currency || null,
        })
        if (wasNew) imported++
        else skipped++

        // Partial refund — deduct just the refunded portion. A full refund was
        // already skipped above via Financial Status, so this only ever fires for
        // "partially_refunded".
        const refundAmount = parseFloat(order.refundedAmount)
        if (wasNew && refundAmount > 0) {
          await recordRefund(clientId, orderId, refundAmount, order.currency || undefined)
          refundsApplied++
        }
      } catch (err) {
        if (errors.length < MAX_ERRORS_RETURNED) {
          errors.push(`${order.name}: ${(err as Error).message}`)
        }
      }
    }

    return reply.send({
      ordersInFile: orders.size,
      imported,
      skipped,
      refundsApplied,
      errors,
    })
  })
}
