import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db'
import { CHAT_TOOLS, executeTool } from './chatTools'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-8'
const MAX_TOOL_ROUNDS = 5

const SYSTEM_PROMPT = `You are a marketing data analyst answering questions about ONE specific client's ad performance for the agency operator using this tool. Use the provided tools to fetch real data before answering - never guess or fabricate numbers. Cite the actual figures you retrieved. Keep answers concise and direct, a few sentences unless the question needs a breakdown. If a tool returns no data or an empty result, say so plainly rather than inventing an explanation.`

// One entry per tool Claude actually called while answering this turn (not the
// synthetic tool_result content blocks fed back to the model) — the dashboard
// renders each of these as a real inline stat tile or mini table next to the
// prose answer, same "answer with a rendered widget, not just text" pattern as
// Triple Whale's Moby.
export interface ChatToolCall {
  tool: string
  input: Record<string, unknown>
  result: object
}

export interface ChatMessageRow {
  id: string
  role: 'user' | 'assistant'
  content: string
  tool_calls: ChatToolCall[] | null
  created_at: string
}

export async function getConversationHistory(clientId: string): Promise<ChatMessageRow[]> {
  const { rows } = await db.query<ChatMessageRow>(
    `SELECT id, role, content, tool_calls, created_at FROM chat_messages WHERE client_id = $1 ORDER BY created_at ASC`,
    [clientId]
  )
  return rows
}

// Runs the tool-use loop: sends the conversation + tool definitions to Claude,
// executes whatever tools it asks for against this app's real data, feeds the
// results back, and repeats until Claude answers with plain text (or the round
// cap is hit, to bound cost/latency on a runaway loop). Both the user's message
// and the final answer are persisted so the thread survives a page reload.
export interface AskQuestionResult {
  text: string
  toolCalls: ChatToolCall[]
}

export async function askQuestion(clientId: string, userMessage: string): Promise<AskQuestionResult> {
  await db.query(`INSERT INTO chat_messages (client_id, role, content) VALUES ($1, 'user', $2)`, [clientId, userMessage])

  const history = await getConversationHistory(clientId)
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))

  let finalText = ''
  const toolCalls: ChatToolCall[] = []
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: CHAT_TOOLS,
      messages,
    })

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')

    if (toolUseBlocks.length === 0) {
      finalText = textBlocks.map((b) => b.text).join('\n').trim()
      break
    }

    messages.push({ role: 'assistant', content: response.content })
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const input = block.input as Record<string, unknown>
        const result = await executeTool(clientId, block.name, input)
        toolCalls.push({ tool: block.name, input, result })
        return {
          type: 'tool_result' as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        }
      })
    )
    messages.push({ role: 'user', content: toolResults })

    if (round === MAX_TOOL_ROUNDS - 1) {
      finalText = "I wasn't able to finish gathering the data needed to answer that within a reasonable number of steps. Try a more specific question."
    }
  }

  await db.query(`INSERT INTO chat_messages (client_id, role, content, tool_calls) VALUES ($1, 'assistant', $2, $3)`, [
    clientId,
    finalText,
    toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
  ])
  return { text: finalText, toolCalls }
}
