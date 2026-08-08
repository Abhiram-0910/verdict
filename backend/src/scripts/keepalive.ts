/**
 * Supabase Keepalive — hits the PostgREST REST API, not raw Postgres.
 *
 * WHY: Supabase's free-tier auto-pause timer is reset only by REST/PostgREST
 * traffic (https://<project>.supabase.co/rest/v1/). A raw postgres TCP
 * connection (SELECT 1 via the pooler) does NOT reset the timer, so the DB
 * pauses even when the workflow succeeds. This script uses the service key to
 * hit the PostgREST root endpoint, which Supabase counts as real activity.
 */

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Keepalive failed: SUPABASE_URL or SUPABASE_SERVICE_KEY not set.');
    process.exit(1);
  }

  console.log('Starting Supabase keepalive ping (REST API)...');

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      },
    });

    if (!res.ok && res.status !== 200) {
      // 200 returns the OpenAPI schema; anything else is unexpected
      const body = await res.text();
      throw new Error(`Unexpected status ${res.status}: ${body}`);
    }

    console.log(`Keepalive success: REST API responded with HTTP ${res.status}.`);
    process.exit(0);
  } catch (error) {
    console.error('Keepalive failed:', error);
    process.exit(1);
  }
}

main();
