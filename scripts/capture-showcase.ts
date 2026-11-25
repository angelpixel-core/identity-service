import { chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = path.resolve(__dirname, '../docs/showcase/assets/screenshots');

async function captureWithFocus(page: Page, selector: string, filename: string): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.style.outline = '2px solid #0b57d0';
      el.style.outlineOffset = '3px';
      el.style.borderRadius = '8px';
    }
  }, selector);
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    fullPage: false,
  });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.borderRadius = '';
    }
  }, selector);
}

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

    // 3c-bis. EPIC-02 / US-28: Client Lifecycle & Zero-Downtime Secret Rotation in /tenant
    console.log('📸 Capturing US-28 Client Lifecycle & Secret Rotation in /tenant...');
    await page.click('[data-testid="register-client-details"] summary');
    await page.fill('#new-client-name', `Showcase Billing Worker ${Date.now()}`);
    await page.selectOption('#new-client-profile', 'm2m');
    await page.fill('#new-client-origins', 'https://billing.acme-corp.com');
    await page.fill('#new-client-scopes', 'read:invoices write:billing');
    await page.click('[data-testid="register-client-submit"]');
    await page.waitForSelector('[data-testid="client-secret-once-banner"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us28_tenant_client_created.png'),
      fullPage: false,
    });

    const firstRotateBtn = page.locator('[data-testid^="rotate-secret-"]').first();
    const rotateTestId = await firstRotateBtn.getAttribute('data-testid');
    const targetClientId = rotateTestId?.replace('rotate-secret-', '') ?? '';
    await firstRotateBtn.click();
    await page.waitForSelector('[data-testid="client-secret-once-banner"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us28_tenant_secret_rotation.png'),
      fullPage: false,
    });

    if (targetClientId) {
      await page.click(`[data-testid="toggle-client-${targetClientId}"]`);
      await page.waitForSelector(`[data-testid="toggle-client-${targetClientId}"]:has-text("Reactivar")`, { timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'us28_tenant_client_suspended.png'),
        fullPage: false,
      });

      // US-29: Inspect Client-Tenant Bindings & Custom Domains in /tenant
      console.log('📸 Capturing US-29 Client-Tenant Bindings in /tenant...');
      await page.click(`[data-testid="view-bindings-${targetClientId}"]`);
      await page.waitForSelector(`[data-testid="tenant-bindings-${targetClientId}"]`, { timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'us29_tenant_client_bindings.png'),
        fullPage: false,
      });
    }

    await page.click('button[role="tab"]:has-text("Laboratorio RLS")');
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'ui_tenant_rls_lab.png'),
      fullPage: false,
    });

    // US-31: Public Auth Config Inspector in /tenant -> Política de Identidad
    console.log('📸 Ensuring portal-web <-> acme-corp binding & capturing US-31 Public Auth Config Inspector...');
    const us31RootRes = await fetch('http://localhost:4000/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'system' },
      body: JSON.stringify({
        email: `showcase.us31.root.${Date.now()}@angelpixel.io`,
        password: 'RootShowcasePassword2026!',
      }),
    });
    const us31Root = await us31RootRes.json();
    await fetch('http://localhost:4000/api/v1/clients/portal-web/bindings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${us31Root.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        tenantId: 'acme-corp',
        customDomain: 'portal.acme-corp.local',
        allowedRedirectUris: ['http://localhost:3000/callback'],
        allowedCorsOrigins: ['http://localhost:3000'],
      }),
    });
    await fetch('http://localhost:4000/api/v1/tenants/acme-corp/federation/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${us31Root.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        providerKey: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
        issuerUrl: 'https://acme.okta.com/oauth2/default',
        clientId: 'okta-b2b-showcase-01',
        clientSecret: 'okta_showcase_secret_2026',
        scopes: ['openid', 'email', 'profile'],
      }),
    });

    await page.click('button[role="tab"]:has-text("Política de Identidad")');
    await page.waitForSelector('[data-testid="tenant-policy-panel"]', { timeout: 10000 });
    await captureWithFocus(page, '[data-testid="tenant-policy-panel"]', 'us30_tenant_policy_editor.png');

    await page.waitForSelector('[data-testid="public-auth-config-inspect-btn"]', { timeout: 10000 });
    await page.click('[data-testid="public-auth-config-inspect-btn"]');
    await page.waitForSelector('[data-testid="public-auth-config-json-viewer"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us31_tenant_auth_config_inspector.png'),
      fullPage: false,
    });

    // US-33: Capture /tenant -> Proveedores IdP
    console.log('📸 Capturing US-33 in /tenant...');
    await page.click('button[role="tab"]:has-text("Proveedores IdP")');
    await page.waitForSelector('[data-testid="idp-providers-list"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await captureWithFocus(page, '[data-testid="idp-providers-list"]', 'us33_tenant_federated_providers.png');

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

    const postureShots: Array<{ file: string; chipPrefix: string }> = [
      { file: 'us12_platform_iac_posture.png', chipPrefix: 'Cloud IaC:' },
      { file: 'us13_platform_ingress_tls.png', chipPrefix: 'Ingress:' },
      { file: 'us14_platform_helm_strict.png', chipPrefix: 'Helm:' },
    ];
    for (const shot of postureShots) {
      await page.evaluate((prefix) => {
        const chips = Array.from(document.querySelectorAll('.m3-chip'));
        chips.forEach((el) => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.textContent?.includes(prefix)) {
            htmlEl.style.outline = '2px solid #0b57d0';
            htmlEl.style.outlineOffset = '2px';
          } else {
            htmlEl.style.outline = '';
            htmlEl.style.outlineOffset = '';
          }
        });
      }, shot.chipPrefix);
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, shot.file),
        fullPage: false,
      });
    }

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

    // US-29: N:M Client-Tenant Bindings in /platform
    console.log('📸 Capturing US-29 Bindings N:M in /platform...');
    await page.click('button[role="tab"]:has-text("Bindings N:M")');
    await page.waitForSelector('[data-testid="platform-bindings-panel"]', { timeout: 10000 });
    const bindingSuffix = Date.now();
    await page.fill('#binding-client-id', 'portal-web');
    await page.fill('#binding-tenant-id', `showcase-tenant-${bindingSuffix}`);
    await page.fill('#binding-domain', `portal-${bindingSuffix}.tusherramientas.com`);
    await page.fill('#binding-origins', `https://portal-${bindingSuffix}.tusherramientas.com`);
    await page.fill('#binding-redirects', `https://portal-${bindingSuffix}.tusherramientas.com/callback`);
    await page.click('[data-testid="create-binding-submit"]');
    await page.waitForSelector('[data-testid^="toggle-binding-"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us29_platform_bindings_nm.png'),
      fullPage: false,
    });

    // US-30: Tenant Policies in /platform
    console.log('📸 Capturing US-30 Tenant Policies in /platform...');
    await page.click('button[role="tab"]:has-text("Tenant Policies")');
    await page.waitForSelector('[data-testid="platform-policies-panel"]', { timeout: 10000 });
    await captureWithFocus(page, '[data-testid="platform-policies-panel"]', 'us30_platform_tenant_policies.png');

    // US-33: Proveedores IdP in /platform
    console.log('📸 Capturing US-33 Proveedores IdP in /platform...');
    await page.click('button[role="tab"]:has-text("Proveedores IdP")');
    await page.waitForSelector('[data-testid="tenant-federated-providers-panel"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="idp-providers-list"]', { timeout: 10000 });
    await captureWithFocus(
      page,
      '[data-testid="tenant-federated-providers-panel"]',
      'us33_platform_federated_providers.png'
    );

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

    // 4b. US-31: Public Dynamic Auth Config JSON Pretty-Print
    console.log('📸 Capturing us31_public_auth_config.png from http://localhost:4000/api/v1/auth/config...');
    await page.goto(
      'http://localhost:4000/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp',
      { waitUntil: 'networkidle', timeout: 10000 }
    );
    await page.waitForTimeout(300);
    await page.mouse.click(105, 12);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us31_public_auth_config.png'),
      fullPage: false,
    });

    // 4c. US-32: Dynamic Onboarding in /auth (Phone E.164 + KYC & Password Disabled)
    console.log('📸 Capturing US-32 Dynamic Onboarding states in /auth...');
    const us32Ts = Date.now();
    const us32PhoneTenant = `us32-phone-${us32Ts}`;
    const us32NoPassTenant = `us32-nopass-${us32Ts}`;
    for (const tid of [us32PhoneTenant, us32NoPassTenant]) {
      await fetch('http://localhost:4000/api/v1/clients/portal-web/bindings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${rootSessionPayload.token}`,
          'x-tenant-id': 'system',
        },
        body: JSON.stringify({
          tenantId: tid,
          customDomain: `${tid}.showcase.local`,
          allowedRedirectUris: ['http://localhost:3000/callback'],
          allowedCorsOrigins: ['http://localhost:3000'],
        }),
      });
    }
    await fetch(`http://localhost:4000/api/v1/tenants/${us32PhoneTenant}/policy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rootSessionPayload.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
      }),
    });
    await fetch(`http://localhost:4000/api/v1/tenants/${us32NoPassTenant}/policy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${rootSessionPayload.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: true },
      }),
    });

    await page.goto('http://localhost:3000/auth', { waitUntil: 'networkidle', timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('identity_session'));

    await page.goto(
      `http://localhost:3000/auth?client_id=portal-web&tenant_id=${us32PhoneTenant}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForSelector('[data-testid="register-phone-input"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="register-kyc-notice"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us32_auth_dynamic_phone_kyc.png'),
      fullPage: false,
    });

    await page.goto(
      `http://localhost:3000/auth?client_id=portal-web&tenant_id=${us32NoPassTenant}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.waitForSelector('[data-testid="auth-password-disabled-banner"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us32_auth_password_disabled.png'),
      fullPage: false,
    });

    // 4d. US-34: Dynamic Tenant Federation Buttons in /auth -> Federación
    console.log('📸 Capturing US-34 Dynamic Federation buttons in /auth...');
    await page.goto(
      'http://localhost:3000/auth?client_id=portal-web&tenant_id=acme-corp',
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await page.click('button[aria-haspopup="listbox"]');
    await page.click('ul[role="listbox"] button:has-text("Federación")');
    await page.waitForSelector('[data-testid="fed-login-okta-corp"]', { timeout: 10000 });
    await captureWithFocus(page, '[data-testid="fed-login-okta-corp"]', 'us34_auth_dynamic_federation.png');

    // 4d. US-35: WebAuthn / FIDO2 Passkey Registration with CDP Virtual Authenticator
    console.log('📸 Preparing US-35 tenant policy (passkeys: true) & CDP Virtual Authenticator...');
    const us35Tenant = `tusherramientas-us35-${Date.now()}`;
    const us35RootRes = await fetch('http://localhost:4000/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': 'system' },
      body: JSON.stringify({
        email: `showcase.us35.root.${Date.now()}@angelpixel.io`,
        password: 'RootShowcasePassword2026!',
      }),
    });
    const us35Root = await us35RootRes.json();

    await fetch('http://localhost:4000/api/v1/clients/portal-web/bindings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${us35Root.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        tenantId: us35Tenant,
        allowedRedirectUris: ['http://localhost:3000/callback'],
        allowedCorsOrigins: ['http://localhost:3000'],
      }),
    });

    await fetch(`http://localhost:4000/api/v1/tenants/${us35Tenant}/policy`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${us35Root.token}`,
        'x-tenant-id': 'system',
      },
      body: JSON.stringify({
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: false },
      }),
    });

    const us35Context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });
    const us35Page = await us35Context.newPage();
    const cdp = await us35Context.newCDPSession(us35Page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    });

    await us35Page.goto(
      `http://localhost:3000/auth?client_id=portal-web&tenant_id=${us35Tenant}`,
      { waitUntil: 'networkidle', timeout: 15000 }
    );
    await us35Page.fill('input[type="email"]', `passkey.user.${Date.now()}@tusherramientas.com`);
    await us35Page.fill('input[type="password"]', 'EnterpriseSecurity2026!');
    await us35Page.click('button[type="submit"]');
    await us35Page.waitForSelector('button:has-text("Cerrar sesión"), [data-testid="passkeys-panel"]', {
      timeout: 10000,
    });
    await us35Page.waitForSelector('[data-testid="register-passkey-btn"]', { timeout: 10000 });
    await us35Page.click('[data-testid="register-passkey-btn"]');
    await us35Page.waitForSelector('[data-testid="passkeys-success"]', { timeout: 10000 });
    await us35Page.waitForSelector('[data-testid="passkeys-list"]', { timeout: 10000 });
    await captureWithFocus(us35Page, '[data-testid="passkeys-panel"]', 'us35_auth_passkey_registration.png');

    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.send('WebAuthn.disable');
    await us35Context.close();

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
