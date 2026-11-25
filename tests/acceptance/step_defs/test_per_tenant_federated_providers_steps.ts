import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { JwtTokenAdapter } from '../../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { InMemoryTenantFederatedProviderRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';

describe('Feature: Per-Tenant Federated Provider Registry (US-33)', () => {
  let tokenProvider: JwtTokenAdapter;
  let app: ReturnType<typeof createApp>;
  let acmeAdminToken: string;
  let globexAdminToken: string;
  let rootToken: string;

  beforeEach(async () => {
    tokenProvider = new JwtTokenAdapter('bdd_secret_us33_32_chars_minimum!');
    app = createApp({
      tokenProvider,
      tenantFederatedProviderRepository: new InMemoryTenantFederatedProviderRepository(),
      secretCipher: new AesGcmSecretCipher('bdd_cipher_key_us33_32_bytes_long!'),
    });

    acmeAdminToken = await tokenProvider.generateToken({
      userId: 'usr-bdd-acme',
      email: 'admin@acme-corp.com',
      tenantId: 'acme-corp',
      roles: ['tenant_admin'],
    });
    globexAdminToken = await tokenProvider.generateToken({
      userId: 'usr-bdd-globex',
      email: 'admin@globex.com',
      tenantId: 'globex',
      roles: ['tenant_admin'],
    });
    rootToken = await tokenProvider.generateToken({
      userId: 'usr-bdd-root',
      email: 'root@angelpixel.io',
      tenantId: 'system',
      roles: ['superadmin'],
    });
  });

  describe('Scenario: Tenant admin registers B2B Okta provider without exposing secret on GET', () => {
    it('returns 201 with hasClientSecret true and omits secret on GET', async () => {
      const postRes = await request(app)
        .post('/api/v1/tenants/acme-corp/federation/providers')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          providerKey: 'okta-corp',
          displayName: 'Okta Corporate',
          protocol: 'oidc',
          issuerUrl: 'https://acme.okta.com/oauth2/default',
          clientId: 'okta-client-bdd',
          clientSecret: 'okta_bdd_secret_value',
        });

      expect(postRes.status).toBe(201);
      expect(postRes.body.hasClientSecret).toBe(true);
      expect(postRes.body.clientSecret).toBeUndefined();

      const getRes = await request(app)
        .get('/api/v1/tenants/acme-corp/federation/providers')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .set('X-Tenant-ID', 'acme-corp');

      expect(getRes.status).toBe(200);
      expect(getRes.body.providers[0].providerKey).toBe('okta-corp');
      expect(getRes.body.providers[0].clientSecret).toBeUndefined();
      expect(getRes.body.providers[0].encryptedClientSecret).toBeUndefined();
    });
  });

  describe('Scenario: Cross-tenant admin cannot read or mutate another tenant IdP registry', () => {
    it('returns 403 Forbidden for cross-tenant GET and POST', async () => {
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
          clientId: 'li-bdd',
          clientSecret: 'li-bdd-secret',
        });
      expect(postRes.status).toBe(403);
    });
  });

  describe('Scenario: Registered tenant IdP propagates to /api/v1/auth/config without secrets', () => {
    it('includes okta-corp in federatedProviders without exposing clientId or secret', async () => {
      await request(app)
        .post('/api/v1/clients/portal-web/bindings')
        .set('Authorization', `Bearer ${rootToken}`)
        .set('X-Tenant-ID', 'system')
        .send({
          tenantId: 'acme-corp',
          customDomain: 'acme.bdd.local',
          allowedRedirectUris: ['https://acme.bdd.local/callback'],
          allowedCorsOrigins: ['https://acme.bdd.local'],
        });

      await request(app)
        .post('/api/v1/tenants/acme-corp/federation/providers')
        .set('Authorization', `Bearer ${acmeAdminToken}`)
        .set('X-Tenant-ID', 'acme-corp')
        .send({
          providerKey: 'okta-corp',
          displayName: 'Okta Corporate',
          protocol: 'oidc',
          issuerUrl: 'https://acme.okta.com/oauth2/default',
          clientId: 'okta-client-bdd',
          clientSecret: 'okta_bdd_secret_value',
        });

      const cfgRes = await request(app).get(
        '/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp'
      );
      expect(cfgRes.status).toBe(200);
      const okta = (cfgRes.body.federatedProviders as Array<Record<string, unknown>>).find(
        (p) => p.id === 'okta-corp'
      );
      expect(okta).toEqual({
        id: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
      });
    });
  });
});
