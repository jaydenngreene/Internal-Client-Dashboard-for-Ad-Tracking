import { FastifyInstance } from 'fastify'
import { getConversationHistory, askQuestion } from '../lib/chatAgent'
import { friendlyAiErrorMessage } from '../lib/aiErrors'

// Conversational AI chat (Step 51) — one thread per client, Claude answers using
// real live-queried data via tool-use (see lib/chatTools.ts), never guesses.
export async function chatRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/clients/:id/chat', async (req, reply) => {
    return reply.send(await getConversationHistory(req.params.id))
  })

  app.post<{ Params: { id: string }; Body: { message: string } }>('/clients/:id/chat', async (req, reply) => {
    const { message } = req.body
    if (!message || !message.trim()) return reply.code(400).send({ error: 'message required' })

    try {
      const answer = await askQuestion(req.params.id, message.trim())
      return reply.send({ answer })
    } catch (err) {
      return reply.code(502).send({ error: friendlyAiErrorMessage(err) })
    }
  })
}
