import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// This table is created and managed at runtime by connect-pg-simple. It is
// declared here only so drizzle-kit push leaves it alone instead of trying
// to drop it on every migration.
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey().notNull(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_user_sessions_expire").on(t.expire),
  }),
);
