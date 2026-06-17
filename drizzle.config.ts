import { defineConfig } from 'drizzle-kit'

// SQLite 现用；schema 集中在 server/db/schema.ts。迁移产物在 server/db/migrations。
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? './data/happychat.db',
  },
})
