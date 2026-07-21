import { z } from 'zod'

export const appConfigUpdateSchema = z.object({
  registrationRequiresInviteCode: z.boolean().optional(),
  sharingEnabled: z.boolean().optional(),
  titleEnabled: z.boolean().optional(),
  titleModelId: z.string().min(1).nullable().optional(),
  titlePrompt: z.string().max(4000).nullable().optional(),
})

export type AppConfigUpdateInput = z.infer<typeof appConfigUpdateSchema>
