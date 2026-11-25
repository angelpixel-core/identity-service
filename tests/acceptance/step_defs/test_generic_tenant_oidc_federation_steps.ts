import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../../../interfaces/http/server';
import { TenantFederatedProvider } from '../../../src/contexts/identity/domain/entities/tenant_federated_provider/entity';
import { TenantId } from '../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { InMemoryTenantFederatedProviderRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';
import { TenantFederatedProviderResolver } from '../../../src/contexts/identity/application/services/tenant_federated_provider_resolver';

function createBddIdToken(params: {
  privateKey: crypto.KeyObject;
  kid: string;
  iss: string;
  aud: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  nonce?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: params.kid })
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: params.iss,
      aud: params.aud,
      sub: params.sub,
      email: params.email,
      email_verified: params.emailVerified,
      nonce: params.nonce,
      iat: now,
      exp: now + 300,
    })
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), params.privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

describe('Feature: Generic OIDC/OAuth2 Adapter and Multi-Tenant Runtime Resolution (US-34)', () => {
  const issuerUrl = 'https://acme.okta.com/oauth2/default';
  const clientId = 'okta-b2b-bdd';
  const kid = 'okta-key-bdd-1';

  let emailVerifiedFlag = true;
  let lastNonce: string | undefined;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    emailVerifiedFlag = true;
    lastNonce = undefined;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;

    const httpClient = jest.fn(async (url: string) => {
      if (url === `${issuerUrl}/.well-known/openid-configuration`) {
        return {
          issuer: issuerUrl,
          authorization_endpoint: `${issuerUrl}/v1/authorize`,
          token_endpoint: `${issuerUrl}/v1/token`,
          jwks_uri: `${issuerUrl}/v1/keys`,
        };
      }
      if (url === `${issuerUrl}/v1/keys`) {
        return { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] };
      }
      if (url === `${issuerUrl}/v1/token`) {
        return {
          id_token: createBddIdToken({
            privateKey,
            kid,
            iss: issuerUrl,
            aud: clientId,
            sub: 'okta-bdd-sub-01',
            email: 'bdd.okta@acme-corp.com',
            emailVerified: emailVerifiedFlag,
            nonce: lastNonce,
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const repo = new InMemoryTenantFederatedProviderRepository();
    const cipher = new AesGcmSecretCipher('bdd_us34_cipher_key_32_bytes_long!');

    await repo.save(
      TenantFederatedProvider.create({
        id: 'idp-okta-bdd-1',
        tenantId: TenantId.create('acme-corp'),
        providerKey: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
        issuerUrl,
        clientId,
        encryptedClientSecret: cipher.encrypt('okta_bdd_secret'),
      })
    );

    const resolver = new TenantFederatedProviderResolver(repo, cipher, [], httpClient);
    app = createApp({
      tenantFederatedProviderRepository: repo,
      secretCipher: cipher,
      tenantFederatedProviderResolver: resolver,
    });
  });

  describe('Scenario: Okta B2B per-tenant login discovers JWKS and issues JWT with provider claim', () => {
    it('provisions user JIT in acme-corp and emits JWT with provider okta-corp', async () => {
      const loginRes = await request(app)
        .get('/api/v1/auth/federation/okta-corp/login')
        .query({
          tenant_id: 'acme-corp',
          redirect_uri: 'https://portal.acme-corp.com/callback',
          format: 'json',
        });

      expect(loginRes.status).toBe(200);
      lastNonce = loginRes.body.nonce;

      const cbRes = await request(app)
        .get('/api/v1/auth/federation/okta-corp/callback')
        .query({ code: 'bdd_code_01', state: loginRes.body.state })
        .set('Accept', 'application/json');

      expect(cbRes.status).toBe(200);
      const token = cbRes.body.tokens.access_token as string;
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));
      expect(claims.provider).toBe('okta-corp');
      expect(claims.tenant_id).toBe('acme-corp');
    });
  });

  describe('Scenario: Cross-tenant login attempt for an unregistered provider is rejected', () => {
    it('returns 400 invalid_request for academia-beisbol', async () => {
      const res = await request(app)
        .get('/api/v1/auth/federation/okta-corp/login')
        .query({
          tenant_id: 'academia-beisbol',
          redirect_uri: 'https://academia.example.com/callback',
          format: 'json',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });
  });

  describe('Scenario: Unverified external email is rejected with 401 invalid_grant', () => {
    it('returns 401 invalid_grant when email_verified is false', async () => {
      emailVerifiedFlag = false;
      const loginRes = await request(app)
        .get('/api/v1/auth/federation/okta-corp/login')
        .query({
          tenant_id: 'acme-corp',
          redirect_uri: 'https://portal.acme-corp.com/callback',
          format: 'json',
        });
      lastNonce = loginRes.body.nonce;

      const cbRes = await request(app)
        .get('/api/v1/auth/federation/okta-corp/callback')
        .query({ code: 'bdd_code_02', state: loginRes.body.state })
        .set('Accept', 'application/json');

      expect(cbRes.status).toBe(401);
      expect(cbRes.body.error).toBe('invalid_grant');
    });
  });
});
