import type { FeedbackCategory, FeedbackDraft, OperationsGateway, PlayerFeedback } from './OperationsGatewayContracts'

/** An uncertain network result keeps its key until the draft changes or success is acknowledged. */
export class FeedbackSubmission {
  public category: FeedbackCategory = 'bug'
  public content = ''
  public busy = false
  private attempt: { fingerprint: string, key: string } | null = null

  public constructor (private readonly createKey = () => `feedback-${Date.now()}-${Math.floor(Math.random() * 1e12)}`) {}

  public validate (): string {
    if (!this.content.trim()) return '请填写反馈内容（1–2000 字）。'
    if (this.content.trim().length > 2000) return '反馈内容不能超过 2000 字，请精简后再提交。'
    if (!['bug', 'suggestion', 'other'].includes(this.category)) return '请选择反馈类型。'
    return ''
  }

  public async submit (gateway: OperationsGateway): Promise<PlayerFeedback | null> {
    if (this.busy) return null
    const error = this.validate()
    if (error) throw new Error(error)
    const draft: FeedbackDraft = { category: this.category, content: this.content.trim() }
    const fingerprint = JSON.stringify(draft)
    if (this.attempt?.fingerprint !== fingerprint) this.attempt = { fingerprint, key: this.createKey() }
    this.busy = true
    try {
      const result = await gateway.submitFeedback(draft, this.attempt.key)
      this.content = ''
      this.attempt = null
      return result
    } finally { this.busy = false }
  }
}
