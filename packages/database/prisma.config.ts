import { defineConfig } from "prisma/config";

// `prisma generate` (run by app prebuild scripts in Docker) needs no real DB,
// so fall back to a placeholder instead of throwing like env("DATABASE_URL").
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
