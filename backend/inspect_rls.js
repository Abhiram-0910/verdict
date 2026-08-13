const postgres = require('postgres');

async function run() {
  const sql = postgres('postgresql://postgres.shsouuvbiyoqcfdmcoxs:VerdictPortfolio%402026@aws-1-ap-south-1.pooler.supabase.com:5432/postgres');
  
  const schemas = await sql`
    SELECT nspname, relname, relrowsecurity 
    FROM pg_class 
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
    WHERE relkind = 'r' AND relrowsecurity = false
    AND nspname = 'drizzle'
  `;
  console.log('Drizzle tables:');
  console.table(schemas);

  await sql.end();
}

run().catch(console.error);
