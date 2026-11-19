import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/showcase/assets/screenshots');

async function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function runCapture() {
  console.log('🚀 Starting Showcase Automated Playwright Capture...');
  await ensureDir(SCREENSHOT_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // High-DPI Retina resolution
  });

  const page = await context.newPage();

  try {
    // 1. Swagger UI OpenAPI Documentation
    console.log('📸 Capturing 00_swagger_ui_portal.png from http://localhost:4000/api/docs/...');
    await page.goto('http://localhost:4000/api/docs/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '00_swagger_ui_portal.png'),
      fullPage: false,
    });

    // 2. US-01: Multi-Tenant User Registration Form
    console.log('📸 Capturing us01_registration_form.png from http://localhost:3000/...');
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('form', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us01_registration_form.png'),
      fullPage: false,
    });

    // 3. US-02: Tenant Authenticated Profile & Session Card
    console.log('📸 Interacting with form and capturing us02_user_profile.png...');
    const uniqueEmail = `showcase.architect.${Date.now()}@acme-corp.com`;
    await page.fill('input[type="email"]', uniqueEmail);
    await page.fill('input[type="password"]', 'EnterpriseSecurity2026!');
    // Fill full name if input exists
    const nameInput = await page.$('input[placeholder*="Nombre"], input[name="name"], input[placeholder*="Name"]');
    if (nameInput) {
      await nameInput.fill('Sofia Valenzuela (Lead Cloud Architect)');
    }

    await page.click('button[type="submit"]');
    await page.waitForSelector('.session-toolbar, .portal-card button', { timeout: 10000 });
    await page.waitForTimeout(1200); // Allow cache hit/profile data to settle
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us02_user_profile.png'),
      fullPage: false,
    });

    // 4. US-07: OpenID Connect Discovery Metadata Endpoint
    console.log('📸 Capturing us07_oidc_discovery.png from http://localhost:4000/.well-known/openid-configuration...');
    await page.goto('http://localhost:4000/.well-known/openid-configuration', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(300);
    // Toggle Chromium built-in JSON viewer "Pretty-print" checkbox (closed Shadow DOM at top-left)
    await page.mouse.click(105, 12);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us07_oidc_discovery.png'),
      fullPage: false,
    });

    // 5. US-21: Prometheus & OpenTelemetry Structured Metrics Exposition
    console.log('📸 Capturing us21_prometheus_metrics.png from http://localhost:4000/metrics...');
    await page.goto('http://localhost:4000/metrics', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us21_prometheus_metrics.png'),
      fullPage: false,
    });

    // 6. US-22: Aggregated Infrastructure Health & Readiness Probes
    console.log('📸 Capturing us22_health_diagnostics.png from http://localhost:4000/health...');
    await page.goto('http://localhost:4000/health', { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us22_health_diagnostics.png'),
      fullPage: false,
    });

    console.log('✅ All showcase captures saved successfully to:', SCREENSHOT_DIR);
  } catch (error) {
    console.error('❌ Error during showcase capture:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runCapture();
