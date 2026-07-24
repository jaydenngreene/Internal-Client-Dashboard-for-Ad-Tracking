import Anthropic from '@anthropic-ai/sdk'

// Every AI feature in this app (Gojo chat, Insights, remarketing drafts, creative
// tagging) was letting the raw Anthropic SDK exception reach the user verbatim on
// failure — internal library wording like "Could not resolve authentication method.
// Expected one of apiKey, authToken, credentials..." that means nothing to an agency
// owner and reads as broken/unmaintained rather than "not configured yet." This is
// the one place that translates any AI-call failure into something a real user
// should actually read, reused by every route/job that calls Claude directly.
export function friendlyAiErrorMessage(err: unknown): string {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Gojo isn't set up for this workspace yet. Ask an admin to add an Anthropic API key."
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "Gojo's API key looks invalid or expired. Ask an admin to check the Anthropic API key."
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Gojo is handling a lot of requests right now. Try again in a moment.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Gojo right now. Try again in a moment."
  }
  return "Gojo couldn't complete that request. Try again, and let us know if it keeps happening."
}
