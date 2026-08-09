import { chromium } from 'playwright';
import path from 'path';

async function main() {
  console.log('Starting design verification (Round 2)...');
  const browser = await chromium.launch({ headless: true });
  
  const contextDesktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageDesktop = await contextDesktop.newPage();
  
  const startTime = Date.now();
  await pageDesktop.goto('http://localhost:3000/');
  
  // Wait 150ms to get ~15% down
  await pageDesktop.waitForTimeout(150);
  console.log(`Early trace screenshot taken at: ${Date.now() - startTime}ms`);
  await pageDesktop.screenshot({ path: path.join(__dirname, '../../artifacts/landing-trace-15-v3.png') });

  // Wait another 450ms (total 600ms) for mid-flight (around 50%)
  await pageDesktop.waitForTimeout(450);
  console.log(`Trace animation screenshot taken at: ${Date.now() - startTime}ms`);
  await pageDesktop.screenshot({ path: path.join(__dirname, '../../artifacts/landing-trace-v3.png') });

  // Wait another 900ms to get to 1500ms total, when the trace hits the bottom badge (~94%)
  await pageDesktop.waitForTimeout(900);
  console.log(`Badge intersection screenshot taken at: ${Date.now() - startTime}ms`);
  await pageDesktop.screenshot({ path: path.join(__dirname, '../../artifacts/landing-badge-intersection-v3.png') });

  await pageDesktop.waitForTimeout(500);
  await pageDesktop.screenshot({ path: path.join(__dirname, '../../artifacts/landing-desktop-v3.png') });
  console.log(`Desktop screenshot taken at: ${Date.now() - startTime}ms`);
  
  const contextMobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const pageMobile = await contextMobile.newPage();
  await pageMobile.goto('http://localhost:3000/');
  await pageMobile.waitForTimeout(1000);
  await pageMobile.screenshot({ path: path.join(__dirname, '../../artifacts/landing-mobile-v3.png') });
  console.log('Mobile screenshot captured: landing-mobile.png');

  console.log('Testing keyboard navigation focus...');
  await pageDesktop.keyboard.press('Tab'); 
  await pageDesktop.waitForTimeout(200);
  
  await pageDesktop.keyboard.press('Tab'); // Focus input URL wrapper
  await pageDesktop.waitForTimeout(200);
  
  // We'll capture a screenshot of the input focus state
  await pageDesktop.screenshot({ path: path.join(__dirname, '../../artifacts/landing-focus.png') });

  // 4. Reduced Motion check
  console.log('Testing reduced motion...');
  const contextMotion = await browser.newContext({ 
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce'
  });
  const pageMotion = await contextMotion.newPage();
  await pageMotion.goto('http://localhost:3000/');
  await pageMotion.waitForTimeout(1000); 

  const overlayDisplay = await pageMotion.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div.bg-signal\\/5'));
    if (els.length > 0) return window.getComputedStyle(els[0]).display;
    return 'not found';
  });

  const scanlineDisplay = await pageMotion.evaluate(() => {
    // The svg container has absolute and z-10
    const line = document.querySelector('.z-10.-translate-y-1\\/2');
    if (line) return window.getComputedStyle(line).display;
    return 'not found';
  });

  console.log(`Reduced motion overlay display: ${overlayDisplay}`);
  console.log(`Reduced motion scanline display: ${scanlineDisplay}`);
  
  await browser.close();
}

main().catch(console.error);
