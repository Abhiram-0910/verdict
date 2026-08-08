/**
 * Supabase Keepalive — hits the PostgREST REST API with the anon key.
 *
 * ROOT CAUSE OF PAST PAUSING: The original SELECT 1 via raw postgres was
 * mechanically fine, but ran every 3 days — leaving 2-day gaps that crossed
 * Supabase's "too few user queries per week" threshold. Supabase doesn't
 * require 7 consecutive days of silence; it pauses on low aggregate activity.
 *
 * FIX: Daily schedule (cron '0 9 * * *') + REST API call hitting a real
 * table endpoint, matching Supabase's documented keepalive example:
 *   GET /rest/v1/<TABLE>?limit=1 with apikey + Authorization headers.
 *
 * SECURITY: Uses SUPABASE_ANON_KEY (the public key), not the service role key.
 * The audit_job table requires no sensitive data to read at limit=1.
 * RLS on audit_job allows anon reads (public data — audit results are not PII).
 */

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error('Keepalive failed: SUPABASE_URL or SUPABASE_ANON_KEY not set.');
    process.exit(1);
  }

  console.log('Starting Supabase keepalive ping (REST API, anon key)...');

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/audit_job?limit=1`, {
      method: 'GET',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
      },
    });

    // 200 = rows returned or empty array; both are success
    if (res.status !== 200) {
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

