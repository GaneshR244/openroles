import { defineConfig } from 'prisma/config';

// Load backend/.env for the Prisma CLI. Node's built-in loader avoids a dotenv dependency.
// In CI or production the variables come from the environment, so a missing file is fine.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
