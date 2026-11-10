import { date, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * The app's own OLTP table. Postgres stays the source of truth for anything
 * a user edits: names, plans, seats, who owns the account, when it renews.
 * `id` is the same number ClickHouse calls `tenant_id`, which is the only
 * thing the two databases need to agree on.
 */
export const accounts = pgTable('accounts', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull(), // free | starter | growth | enterprise
  seats: integer('seats').notNull(),
  owner: text('owner').notNull(), // account manager
  renewsOn: date('renews_on').notNull(),
});

export type Account = typeof accounts.$inferSelect;
