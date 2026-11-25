import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../../../../interfaces/http/server';
import { TenantFederatedProvider } from '../../../../src/contexts/identity/domain/entities/tenant_federated_provider/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { InMemoryTenantFederatedProviderRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';
import { TenantFederatedProviderResolver } from '../../../../src/contexts/identity/application/services/tenant_federated_provider_resolver';

function signIdToken(params: {
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

describe('Integration API: US-34 Generic OIDC Adapter & Multi-Tenant Federation', () => {
  const issuerUrl = 'https://acme.okta.com/oauth2/default';
  const clientId = 'okta-b2b-client';
  const kid = 'okta-key-int-1';

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
          id_token: signIdToken({
            privateKey,
            kid,
            iss: issuerUrl,
            aud: clientId,
            sub: 'okta-sub-001',
            email: 'federated.okta@acme-corp.com',
            emailVerified: emailVerifiedFlag,
            nonce: lastNonce,
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const repo = new InMemoryTenantFederatedProviderRepository();
    const cipher = new AesGcmSecretCipher('int_us34_cipher_key_32_bytes_long!');

    await repo.save(
      TenantFederatedProvider.create({
        id: 'idp-okta-int-1',
        tenantId: TenantId.create('acme-corp'),
        providerKey: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
        issuerUrl,
        clientId,
        encryptedClientSecret: cipher.encrypt('okta_raw_secret_int'),
      })
    );

    const resolver = new TenantFederatedProviderResolver(repo, cipher, [], httpClient);
    app = createApp({
      tenantFederatedProviderRepository: repo,
      secretCipher: cipher,
      tenantFederatedProviderResolver: resolver,
    });
  });

  it('completes login & callback for tenant Okta provider, issuing JWT with provider claim and HttpOnly refresh cookie', async () => {
    const loginRes = await request(app)
      .get('/api/v1/auth/federation/okta-corp/login')
      .query({
        tenant_id: 'acme-corp',
        redirect_uri: 'https://portal.acme-corp.com/callback',
        format: 'json',
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.url).toContain(`${issuerUrl}/v1/authorize`);
    expect(loginRes.body.state).toBeTruthy();
    lastNonce = loginRes.body.nonce;

    const callbackRes = await request(app)
      .get('/api/v1/auth/federation/okta-corp/callback')
      .query({
        code: 'okta_auth_code_01',
        state: loginRes.body.state,
      })
      .set('Accept', 'application/json');

    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.user.tenantId).toBe('acme-corp');
    expect(callbackRes.body.user.email).toBe('federated.okta@acme-corp.com');

    const accessToken = callbackRes.body.tokens.access_token as string;
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8'));
    expect(claims.provider).toBe('okta-corp');
    expect(claims.tenant_id).toBe('acme-corp');

    const cookies = callbackRes.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(
      true
    );
  });

  it('rejects okta-corp login for an isolated tenant without that provider', async () => {
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

  it('rejects callback with 401 invalid_grant when external IdP returns email_verified: false', async () => {
    emailVerifiedFlag = false;

    const loginRes = await request(app)
      .get('/api/v1/auth/federation/okta-corp/login')
      .query({
        tenant_id: 'acme-corp',
        redirect_uri: 'https://portal.acme-corp.com/callback',
        format: 'json',
      });

    const callbackRes = await request(app)
      .get('/api/v1/auth/federation/okta-corp/callback')
      .query({
        code: 'okta_auth_code_unverified',
        state: loginRes.body.state,
      })
      .set('Accept', 'application/json');

    expect(callbackRes.status).toBe(401);
    expect(callbackRes.body.error).toBe('invalid_grant');
  });
});
