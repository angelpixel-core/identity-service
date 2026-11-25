import crypto from 'crypto';
import { GenericOidcAdapter } from '../../../../../src/contexts/identity/infrastructure/federation/generic_oidc_adapter';
import { TenantFederatedProviderResolver } from '../../../../../src/contexts/identity/application/services/tenant_federated_provider_resolver';
import { InMemoryTenantFederatedProviderRepository } from '../../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';
import { TenantFederatedProvider } from '../../../../../src/contexts/identity/domain/entities/tenant_federated_provider/entity';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { ExternalIdentityProviderPort } from '../../../../../src/contexts/identity/domain/ports/external_identity_provider_port';

function createSignedIdToken(params: {
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

describe('Unit: US-34 GenericOidcAdapter & TenantFederatedProviderResolver', () => {
  it('discovers OIDC metadata once within cache TTL, builds auth URL, and verifies RS256 id_token via JWKS', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    const kid = 'okta-key-1';
    const issuerUrl = 'https://acme.okta.com/oauth2/default';
    const clientId = 'okta-b2b-client';

    let discoveryCalls = 0;
    const httpClient = jest.fn(async (url: string) => {
      if (url === `${issuerUrl}/.well-known/openid-configuration`) {
        discoveryCalls += 1;
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
          id_token: createSignedIdToken({
            privateKey,
            kid,
            iss: issuerUrl,
            aud: clientId,
            sub: 'okta-user-99',
            email: 'sofia@acme-corp.com',
            emailVerified: true,
            nonce: 'nonce_123',
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const adapter = new GenericOidcAdapter({
      providerId: 'okta-corp',
      issuerUrl,
      clientId,
      clientSecret: 'okta_secret_01',
      discoveryTtlMs: 60_000,
      httpClient,
    });

    const url1 = await adapter.getAuthorizationUrl({
      tenantId: 'acme-corp',
      redirectUri: 'https://portal.acme-corp.com/callback',
      state: 'state_abc',
      nonce: 'nonce_123',
    });
    const url2 = await adapter.getAuthorizationUrl({
      tenantId: 'acme-corp',
      redirectUri: 'https://portal.acme-corp.com/callback',
      state: 'state_def',
      nonce: 'nonce_456',
    });

    expect(discoveryCalls).toBe(1);
    expect(url1).toContain(`${issuerUrl}/v1/authorize`);
    expect(url1).toContain('state=state_abc');
    expect(url2).toContain('nonce=nonce_456');

    const profile = await adapter.exchangeCodeAndVerifyToken({
      code: 'auth_code_123',
      redirectUri: 'https://portal.acme-corp.com/callback',
      nonce: 'nonce_123',
    });

    expect(profile).toMatchObject({
      provider: 'okta-corp',
      externalSubjectId: 'okta-user-99',
      email: 'sofia@acme-corp.com',
      emailVerified: true,
    });
  });

  it('resolves tenant provider override decrypting secret in memory and falls back to global providers', async () => {
    const repo = new InMemoryTenantFederatedProviderRepository();
    const cipher = new AesGcmSecretCipher('unit_resolver_master_key_32_bytes!');

    await repo.save(
      TenantFederatedProvider.create({
        id: 'idp-1',
        tenantId: TenantId.create('acme-corp'),
        providerKey: 'okta-corp',
        displayName: 'Okta Corporate',
        protocol: 'oidc',
        issuerUrl: 'https://acme.okta.com/oauth2/default',
        clientId: 'okta-cid',
        encryptedClientSecret: cipher.encrypt('decrypted_okta_secret'),
      })
    );

    const globalGoogle = { providerId: 'google' } as ExternalIdentityProviderPort;
    const resolver = new TenantFederatedProviderResolver(repo, cipher, [globalGoogle]);

    const resolvedOkta = await resolver.resolve('acme-corp', 'okta-corp');
    expect(resolvedOkta).toBeInstanceOf(GenericOidcAdapter);
    expect(resolvedOkta?.providerId).toBe('okta-corp');

    const resolvedGoogle = await resolver.resolve('acme-corp', 'google');
    expect(resolvedGoogle).toBe(globalGoogle);

    const isolatedOkta = await resolver.resolve('academia-beisbol', 'okta-corp');
    expect(isolatedOkta).toBeNull();
  });
});
