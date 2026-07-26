import '../env.js';
import { db } from '../db/client.js';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Starting Supabase keepalive ping...');
  try {
    await db.execute(sql`SELECT 1`);
    console.log('Keepalive success: SELECT 1 executed correctly.');
    process.exit(0);
  } catch (error) {
    console.error('Keepalive failed:', error);
    process.exit(1);
  }
}

main();
