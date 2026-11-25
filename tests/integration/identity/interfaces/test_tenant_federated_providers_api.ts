import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { InMemorySecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { InMemoryTenantFederatedProviderRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Integration API: /api/v1/tenants/:tenantId/federation/providers (US-33)', () => {
  let tokenProvider: JwtTokenAdapter;
  let auditLogger: InMemorySecurityAuditLogger;
  let idpRepo: InMemoryTenantFederatedProviderRepository;
  let secretCipher: AesGcmSecretCipher;
  let app: ReturnType<typeof createApp>;

  let acmeAdminToken: string;
  let globexAdminToken: string;
  let rootToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('integration_secret_us33_32_chars_min!');
    auditLogger = new InMemorySecurityAuditLogger();
    idpRepo = new InMemoryTenantFederatedProviderRepository();
    secretCipher = new AesGcmSecretCipher('integration_cipher_master_key_32_bytes!');

    app = createApp({
      tokenProvider,
      auditLogger,
      tenantFederatedProviderRepository: idpRepo,
      secretCipher,
    });

    acmeAdminToken = await tokenProvider.generateToken({
      userId: 'usr-acme-admin',
      email: 'admin@acme-corp.com',
      tenantId: 'acme-corp',
      roles: ['tenant_admin'],
    });
    globexAdminToken = await tokenProvider.generateToken({
      userId: 'usr-globex-admin',
      email: 'admin@globex.com',
      tenantId: 'globex',
      roles: ['tenant_admin'],
    });
    rootToken = await tokenProvider.generateToken({
      userId: 'usr-root-01',
      email: 'root@angelpixel.io',
      tenantId: 'system',
      roles: ['superadmin'],
    });

    // Seed client + binding for US-31 /auth/config verification
    await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        clientName: 'Ecommerce SaaS',
        clientProfile: 'spa',
        allowedOrigins: ['https://acme.example.com'],
        redirectUris: ['https://acme.example.com/callback'],
        scopes: ['openid', 'profile'],
      });
  });

  it('registers Okta provider with AES-256-GCM encryption and never leaks secrets on GET', async () => {
    const createRes = await request(app)
      .post('/api/v1/tenants/acme-corp/federation/providers')
      .set('Authorization', `Bearer ${acmeAdminToken}`)
      .set('X-Tenant-ID', 'acme-corp')
      .send({
        providerKey: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
        issuerUrl: 'https://acme.okta.com/oauth2/default',
        clientId: 'okta-b2b-01',
        clientSecret: 'raw_okta_secret_never_exposed',
        scopes: ['openid', 'email', 'profile'],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.providerKey).toBe('okta-corp');
    expect(createRes.body.hasClientSecret).toBe(true);
    expect(createRes.body.clientSecret).toBeUndefined();
    expect(createRes.body.encryptedClientSecret).toBeUndefined();

    const stored = await idpRepo.findByTenantAndKey(TenantId.create('acme-corp'), 'okta-corp');
    expect(stored).not.toBeNull();
    expect(stored!.getEncryptedClientSecret().startsWith('v1:')).toBe(true);
    expect(secretCipher.decrypt(stored!.getEncryptedClientSecret())).toBe(
      'raw_okta_secret_never_exposed'
    );

    const listRes = await request(app)
      .get('/api/v1/tenants/acme-corp/federation/providers')
      .set('Authorization', `Bearer ${acmeAdminToken}`)
      .set('X-Tenant-ID', 'acme-corp');

    expect(listRes.status).toBe(200);
    expect(listRes.body.count).toBe(1);
    expect(listRes.body.providers[0].hasClientSecret).toBe(true);
    expect(listRes.body.providers[0].clientSecret).toBeUndefined();
  });

  it('blocks cross-tenant GET/POST/DELETE with 403 Forbidden', async () => {
    const getRes = await request(app)
      .get('/api/v1/tenants/acme-corp/federation/providers')
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .set('X-Tenant-ID', 'globex');
    expect(getRes.status).toBe(403);

    const postRes = await request(app)
      .post('/api/v1/tenants/acme-corp/federation/providers')
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .set('X-Tenant-ID', 'globex')
      .send({
        providerKey: 'linkedin',
        displayName: 'LinkedIn',
        protocol: 'oauth2',
        issuerUrl: 'https://www.linkedin.com',
        clientId: 'li-01',
        clientSecret: 'li-sec-01',
      });
    expect(postRes.status).toBe(403);

    const delRes = await request(app)
      .delete('/api/v1/tenants/acme-corp/federation/providers/okta-corp')
      .set('Authorization', `Bearer ${globexAdminToken}`)
      .set('X-Tenant-ID', 'globex');
    expect(delRes.status).toBe(403);
  });

  it('allows system:superadmin cross-tenant management, emits redacted audit, and invalidates US-31 auth config cache', async () => {
    // Create explicit client-tenant binding for portal-web -> acme-corp
    await request(app)
      .post('/api/v1/clients/portal-web/bindings')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        tenantId: 'acme-corp',
        customDomain: 'acme.example.com',
        allowedRedirectUris: ['https://acme.example.com/callback'],
        allowedCorsOrigins: ['https://acme.example.com'],
      });

    // Warm US-31 cache before registering Slack
    const beforeCfg = await request(app).get(
      '/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp'
    );
    expect(beforeCfg.status).toBe(200);
    expect(
      (beforeCfg.body.federatedProviders as Array<{ id: string }>).some((p) => p.id === 'slack')
    ).toBe(false);

    const postRes = await request(app)
      .post('/api/v1/tenants/acme-corp/federation/providers')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system')
      .send({
        providerKey: 'slack',
        displayName: 'Slack Enterprise',
        protocol: 'oauth2',
        issuerUrl: 'https://slack.com',
        clientId: 'slack-01',
        clientSecret: 'slack_secret_value_2026',
      });
    expect(postRes.status).toBe(201);

    const afterCfg = await request(app).get(
      '/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp'
    );
    expect(afterCfg.status).toBe(200);
    expect(
      (afterCfg.body.federatedProviders as Array<{ id: string }>).some((p) => p.id === 'slack')
    ).toBe(true);

    const delRes = await request(app)
      .delete('/api/v1/tenants/acme-corp/federation/providers/slack')
      .set('Authorization', `Bearer ${rootToken}`)
      .set('X-Tenant-ID', 'system');
    expect(delRes.status).toBe(200);
    expect(delRes.body.removed).toBe(true);

    const afterDelCfg = await request(app).get(
      '/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp'
    );
    expect(
      (afterDelCfg.body.federatedProviders as Array<{ id: string }>).some((p) => p.id === 'slack')
    ).toBe(false);

    const events = auditLogger.getEvents();
    const idpRegEvent = events.find((e) => e.eventType === 'TENANT_IDP_REGISTERED');
    expect(idpRegEvent).toBeDefined();
    expect(idpRegEvent?.details?.clientSecret).toBe('[REDACTED]');
    expect(
      events.some((e) => e.eventType === 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION')
    ).toBe(true);
  });
});
