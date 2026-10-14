import { Hono } from 'hono'
import { messageQueueActionSchema } from '@shared/schemas/message-queue'
import { requireUser } from '../auth/middleware'
import { jsonValidator } from '../http/validator'
import type { AppEnv } from '../http/types'
import { changeMessageQueue, listMessageQueues, MessageQueueError } from '../services/message-queue'

export const messageQueueRoutes = new Hono<AppEnv>()
messageQueueRoutes.use('*', requireUser)
messageQueueRoutes.get('/', (c) => c.json({ queues: listMessageQueues(c.get('user').id) }))
messageQueueRoutes.post('/:conversationId', jsonValidator(messageQueueActionSchema), (c) => {
  try {
    return c.json({
      queue: changeMessageQueue(
        c.get('user').id,
        c.req.param('conversationId'),
        c.req.valid('json'),
      ),
    })
  } catch (error) {
    if (error instanceof MessageQueueError)
      return c.json({ error: { message: error.message, code: 'queue_conflict' } }, error.status)
    throw error
  }
})
