export interface RequestPreviewDTO {
  method: 'POST'
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
  parameters: { name: string; source: string; description: string }[]
  notes: string[]
}
