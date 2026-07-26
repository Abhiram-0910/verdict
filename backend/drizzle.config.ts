import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

// If running locally, load the root .env file.
// In production, Render injects env vars directly and dotenv fails silently if file is missing.
import * as dotenv from 'dotenv';
dotenv.config({ path: join(__dirname, '..', '.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
