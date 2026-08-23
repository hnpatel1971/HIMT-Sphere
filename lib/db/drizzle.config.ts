import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // connect-pg-simple owns this table and creates it independently of Drizzle.
  // Excluding it prevents schema pushes from proposing deletion of active admin
  // sessions while still reporting changes to every application-owned table.
  tablesFilter: ["!user_sessions"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
