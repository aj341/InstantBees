import { defineConfig } from "drizzle-kit";
import path from "path";

const databasePath = process.env.SQLITE_DATABASE_PATH ?? "../../data/sales-automation.sqlite";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
