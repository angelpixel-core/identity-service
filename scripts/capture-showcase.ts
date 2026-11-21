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
    ignoreHTTPSErrors: true, // Allow self-signed local TLS certs (Floci ARM & NGINX Ingress)
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
    await page.waitForSelector('button:has-text("Cerrar sesión"), .session-toolbar, .portal-card button', { timeout: 10000 });
    await page.waitForTimeout(1000); // Allow cache hit/profile data to settle
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us02_user_profile.png'),
      fullPage: false,
    });

    // 3b. EPIC-09 / US-24: M3 /auth Portal tabs (Account, OIDC/JWKS, PKCE/Sessions, Federation)
    console.log('📸 Capturing /auth M3 UI surfaces...');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_auth_account.png'),
      fullPage: false,
    });

    await page.click('button[aria-haspopup="listbox"]');
    await page.click('ul[role="listbox"] button:has-text("OIDC & JWKS")');
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_auth_oidc_jwks.png'),
      fullPage: false,
    });

    await page.click('button[aria-haspopup="listbox"]');
    await page.click('ul[role="listbox"] button:has-text("PKCE & Sesiones")');
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_auth_pkce_sessions.png'),
      fullPage: false,
    });

    await page.click('button[aria-haspopup="listbox"]');
    await page.click('ul[role="listbox"] button:has-text("Federación")');
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_auth_federation.png'),
      fullPage: false,
    });

    // 3c. EPIC-09 / US-25: M3 /tenant Console (Clients & CORS, RLS Lab)
    console.log('📸 Capturing /tenant M3 UI surfaces...');
    await page.goto('http://localhost:3000/tenant', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('button[role="tab"]:has-text("Clientes & CORS")', { timeout: 10000 });
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_tenant_clients_m2m.png'),
      fullPage: false,
    });

    await page.click('button[role="tab"]:has-text("Laboratorio RLS")');
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_tenant_rls_lab.png'),
      fullPage: false,
    });

    // 3d. EPIC-09 / US-26: M3 /platform Console (Root Superadmin in system tenant)
    console.log('📸 Provisioning Root Superadmin session and capturing /platform M3 UI surfaces...');
    const rootEmail = `showcase.root.${Date.now()}@angelpixel.io`;
    const rootRegRes = await fetch('http://localhost:4000/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        email: rootEmail,
        password: 'RootShowcasePassword2026!',
      }),
    });
    const rootSessionPayload = await rootRegRes.json();
    await page.evaluate((sess) => {
      localStorage.setItem(
        'identity_session',
        JSON.stringify({
          token: sess.token,
          userId: sess.userId,
          email: sess.email,
          tenantId: 'system',
          roles: ['superadmin', 'member'],
        })
      );
    }, rootSessionPayload);

    await page.goto('http://localhost:3000/platform', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForSelector('[data-testid="platform-posture-summary"]', { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_platform_posture.png'),
      fullPage: false,
    });

    await page.click('button[role="tab"]:has-text("Bóveda Criptográfica")');
    await page.waitForSelector('[data-testid="vault-status-summary"]', { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_platform_vault_audit.png'),
      fullPage: false,
    });

    await page.click('button[role="tab"]:has-text("Observabilidad SRE")');
    await page.waitForSelector('[data-testid="sre-observability-summary"]', { timeout: 10000 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_platform_sre.png'),
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

    // 7. US-12: Floci Azure ARM Local Emulator Dashboard (optional if cloud profile is running)
    console.log('📸 Capturing us12_floci_azure_dashboard.png from https://localhost:4577/...');
    try {
      await page.goto('https://localhost:4577/', { waitUntil: 'networkidle', timeout: 8000 });
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'us12_floci_azure_dashboard.png'),
        fullPage: false,
      });
    } catch {
      console.warn('⚠️ Floci Azure ARM dashboard not reachable on https://localhost:4577; skipping us12_floci_azure_dashboard.png');
    }

    console.log('✅ All showcase captures saved successfully to:', SCREENSHOT_DIR);
  } catch (error) {
    console.error('❌ Error during showcase capture:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runCapture();
