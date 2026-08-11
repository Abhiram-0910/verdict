import { execSync } from 'child_process';
import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3001';

async function testBYOKKeys() {
  console.log('--- 1. BYOK Key Handling & 6. Info Leakage ---');
  const badKeys = [
    '', // empty
    'A'.repeat(5000), // very long
    "'; DROP TABLE audit_job; --", // SQLi
    "<script>alert(1)</script>", // XSS
    "key\u0000with\u0000nulls", // Null bytes
  ];

  for (const key of badKeys) {
    const res = await fetch(`${API_BASE}/api/providers/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', apiKey: key })
    });
    const text = await res.text();
    console.log(`[Key test length ${key.length}] Status: ${res.status}`);
    
    // Check for stack traces or DB paths or secrets
    if (text.includes('node_modules') || text.includes('drizzle') || text.includes('postgres') || text.includes('file://')) {
      console.log(`LEAK DETECTED in response: ${text.slice(0, 100)}...`);
    }
    
    // Attempt audit with bad key (should fail at Zod or cleanly in agent)
    const auditRes = await fetch(`${API_BASE}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', byokProvider: 'openai', byokApiKey: key })
    });
    const auditText = await auditRes.text();
    console.log(`[Audit key test length ${key.length}] Status: ${auditRes.status}`);
    
    if (auditText.includes('node_modules') || auditText.includes('drizzle')) {
      console.log(`LEAK DETECTED in response: ${auditText.slice(0, 100)}...`);
    }
  }
}

async function testRateLimitBypass() {
  console.log('\n--- 4. Rate Limiter Bypass ---');
  // Send 6 requests (limit is 5)
  console.log("Sending 6 requests without cookie...");
  for(let i=0; i<6; i++) {
    const res = await fetch(`${API_BASE}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    console.log(`Req ${i+1}: ${res.status}`);
  }
  
  console.log("Sending with X-Forwarded-For spoof...");
  const bypassRes = await fetch(`${API_BASE}/api/audits`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Forwarded-For': '192.168.1.100',
      'X-Real-IP': '192.168.1.100'
    },
    body: JSON.stringify({ url: 'https://example.com' })
  });
  console.log(`Spoof Req: ${bypassRes.status}`);
}

async function testSSRF() {
  console.log('\n--- 5. SSRF Targets ---');
  const targets = [
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://169.254.169.254'
  ];
  
  for (const url of targets) {
    const res = await fetch(`${API_BASE}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    console.log(`[SSRF test ${url}] Status: ${res.status}, ID: ${data.id}`);
    
    if (data.id) {
       // Check the job status after 3 seconds
       await new Promise(r => setTimeout(r, 3000));
       const check = await fetch(`${API_BASE}/api/audits/${data.id}`);
       const checkData = await check.json();
       console.log(`  -> Final status for ${url}: ${checkData.job.status} / ${checkData.job.failureReason}`);
    }
  }
}

async function runAudit() {
  console.log('\n--- 7. Dependency Audit ---');
  try {
    console.log("Backend Audit:");
    execSync('npm audit --json', { stdio: 'pipe' });
    console.log("Clean.");
  } catch (e: any) {
    const res = JSON.parse(e.stdout.toString());
    console.log(`Found ${res.metadata.vulnerabilities.total} vulns in backend.`);
  }

  try {
    console.log("Frontend Audit:");
    execSync('cd ../frontend && npm audit --json', { stdio: 'pipe' });
    console.log("Clean.");
  } catch (e: any) {
    const res = JSON.parse(e.stdout.toString());
    console.log(`Found ${res.metadata.vulnerabilities.total} vulns in frontend.`);
  }
}

async function run() {
  await testBYOKKeys();
  await testRateLimitBypass();
  await testSSRF();
  await runAudit();
  console.log("Done");
}

run();
