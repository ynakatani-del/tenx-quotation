export type InlineImage = {
  cid: string
  filename: string
  mimeType: string
  base64: string
}

export type EmailAttachment = {
  filename: string
  mimeType: string
  base64: string
}

type GmailMessage = {
  to: string
  subject: string
  text: string
  html: string
  senderName?: string
  inlineImages?: InlineImage[]
  attachments?: EmailAttachment[]
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export async function sendGmail(message: GmailMessage): Promise<void> {
  const relayUrl = Deno.env.get('GMAIL_RELAY_URL')
  const relaySecret = Deno.env.get('GMAIL_RELAY_SECRET')
  if (!relayUrl || !relaySecret) throw new Error('Gmail relay is not configured')

  const response = await fetch(relayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ secret: relaySecret, ...message }),
  })

  const resultText = await response.text()
  if (!response.ok) throw new Error(`Gmail relay failed (${response.status}): ${resultText}`)

  try {
    const result = JSON.parse(resultText)
    if (!result.ok) throw new Error(result.error || 'Gmail relay returned an error')
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Gmail relay returned an invalid response')
    throw error
  }
}
