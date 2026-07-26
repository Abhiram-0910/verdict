/**
 * db/client.ts
 *
 * Singleton Drizzle client instance connected to Supabase Postgres.
 * Uses the lightweight 'postgres' driver (postgres.js).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in the environment');
}

// For a serverless/server environment, postgres.js handles connection pooling.
// We configure max=10 to stay well within Supabase's free tier limits.
const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });
