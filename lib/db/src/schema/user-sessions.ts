import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const userSessionsTable = sqliteTable(
  "user_sessions",
  {
    sid: text("sid").primaryKey().notNull(),
    sess: text("sess", { mode: "json" }).notNull(),
    expire: integer("expire", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_user_sessions_expire").on(t.expire),
  }),
);
