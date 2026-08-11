import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: 'C:/Projects/verdict/.env' });
console.log('API KEY IN TEST:', process.env.GEMINI_API_KEY ? 'EXISTS' : 'MISSING');
import http from 'http';

const FRONTEND_URL = 'http://127.0.0.1:3000';

async function testScenario(name, fn) {
  console.log(`\n============================================`);
  console.log(`[TEST] ${name}`);
  console.log(`============================================`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}\n${err.stack || err}`);
    if (global.currentPage) {
       await global.currentPage.screenshot({ path: `fail-${name.replace(/[^a-z0-9]/gi, '_')}.png` });
       console.log('DOM Dump: ' + await global.currentPage.content());
    }
    process.exitCode = 1;
  }
}

async function run() {
  // Start mock server for partial failure
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/fail') {
      res.end('<html><body>FORCE_PARTIAL_FAILURE</body></html>');
    } else {
      res.end('<html><body>Normal Page</body></html>');
    }
  });
  server.listen(9999);

  const browser = await chromium.launch();
  let context = await browser.newContext();

  await testScenario('2. Full default-path audit', async () => {
    const page = await context.newPage();
    global.currentPage = page;
    await page.goto(FRONTEND_URL);
    await page.fill('input[placeholder="example.com"]', 'http://127.0.0.1:9999/default');
    await page.click('button[type="submit"]');

    console.log('Submitted audit for example.com, waiting for redirect to /report/:id');
    await page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 10000 });
    console.log('Redirected to report page, waiting for result...');

    await page.waitForSelector('text=Overall Score', { timeout: 90000 });
    
    // Check score card
    const scoreText = await page.locator('text=Overall Score').locator('..').innerText();
    console.log(`Score Section Output:\n${scoreText.replace(/\n/g, ' | ')}`);
    
    // Check bounding boxes
    const boxCount = await page.locator('div[aria-hidden="true"]').count();
    console.log(`Found ${boxCount} bounding boxes on the report`);

    await page.close();
  });

  await testScenario('3. BYOK path', async () => {
    const page = await context.newPage();
    global.currentPage = page;
    await page.goto(FRONTEND_URL);
    
    // Toggle BYOK panel
    await page.click('text=Use your own API key');
    
    // Select gemini first
    const selects = page.locator('select');
    await selects.nth(0).selectOption('gemini');
    
    // Fill key
    await page.fill('input[type="password"]', process.env.GEMINI_API_KEY || 'fake-key');
    
    // Wait for the model select to populate (the second select)
    await selects.nth(1).waitFor({ state: 'attached' });
    await page.waitForTimeout(1000);
    
    await page.fill('input[placeholder="example.com"]', 'http://127.0.0.1:9999/byok');
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 10000 });
    await page.waitForSelector('text=Overall Score', { timeout: 90000 });

    const badge = await page.locator('text=Audited with').count();
    console.log(`Found "Audited with" badge count: ${badge}`);
    
    if (badge === 0) throw new Error('BYOK badge not found on report page');

    await page.close();
  });

  await testScenario('5. Genuine partial-failure case', async () => {
    const page = await context.newPage();
    global.currentPage = page;
    await page.goto(FRONTEND_URL);
    
    await page.click('text=Use your own API key');
    const selects = page.locator('select');
    await selects.nth(0).selectOption('openrouter');
    await page.fill('input[type="password"]', 'sk-or-v1-invalid-test-key-123456');
    await selects.nth(1).waitFor({ state: 'attached' });
    await page.waitForTimeout(1000);
    
    await page.fill('input[placeholder="example.com"]', 'http://127.0.0.1:9999/fail');
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 10000 });
    await page.waitForSelector('text=Overall Score', { timeout: 90000 });

    // Look for partial results banner
    const bannerCount = await page.locator('text=Partial Results').count();
    console.log(`Found "Partial Results" banner: ${bannerCount > 0 ? 'Yes' : 'No'}`);
    
    if (bannerCount === 0) throw new Error('Partial results banner not found');

    const copyScore = await page.locator('div.rounded-lg:has(h3:has-text("Copy"))').innerText();
    console.log(`Copy Score text:\n${copyScore.replace(/\n/g, ' | ')}`);

    if (!copyScore.includes('N/A') && !copyScore.includes('FAILED')) {
      throw new Error('Copy score did not show FAILED or N/A appropriately');
    }

    await page.close();
  });

  await testScenario('6. SSRF blocking from UI', async () => {
    const page = await context.newPage();
    global.currentPage = page;
    await page.goto(FRONTEND_URL);
    await page.fill('input[placeholder="example.com"]', 'http://localhost:3001');
    await page.click('button[type="submit"]');

    // Should display an error on the landing page, or go to report page and show failed?
    // In our implementation, SSRF causes the backend to fail the audit job. 
    // The UI should go to the report page, poll, and then show the failure screen.
    await page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 10000 });
    await page.waitForSelector('text=Audit Failed', { timeout: 90000 });

    const errorText = await page.locator('h2:has-text("Audit Failed")').locator('..').innerText();
    console.log(`Error Screen Text:\n${errorText.replace(/\n/g, ' | ')}`);

    await page.close();
  });

  await testScenario('7. Mobile viewport, full flow', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await mobileContext.newPage();
    global.currentPage = page;
    await page.goto(FRONTEND_URL);
    await page.fill('input[placeholder="example.com"]', 'http://127.0.0.1:9999/mobile');
    await page.click('button[type="submit"]');

    await page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 10000 });
    await page.waitForSelector('text=Overall Score', { timeout: 90000 });

    console.log(`Mobile report rendered successfully.`);
    await page.close();
  });

  // We do rate limit last so it doesn't block the other tests!
  await testScenario('4. Rate-limit-hit flow, live', async () => {
    const page = await context.newPage();
    
    for (let i = 0; i < 4; i++) {
      await page.goto(FRONTEND_URL);
      await page.fill('input[placeholder="example.com"]', `http://127.0.0.1:9999/ratelimit-${i}`);
      await page.click('button[type="submit"]');
      await new Promise(r => setTimeout(r, 1000));
    }

    // After 3 limits, the 4th should trigger the rate limit message on the landing page
    await page.goto(FRONTEND_URL);
    await page.fill('input[placeholder="example.com"]', 'http://127.0.0.1:9999/ratelimit-4');
    await page.click('button[type="submit"]');

    const errorMsg = await page.locator('text=free audits').innerText();
    console.log(`Rate limit error displayed: ${errorMsg}`);

    // Check if BYOK expanded automatically
    const byokExpanded = await page.locator('input[type="password"]').isVisible();
    console.log(`BYOK panel auto-expanded: ${byokExpanded}`);

    await page.close();
  });

  await browser.close();
  server.close();
}

run();
