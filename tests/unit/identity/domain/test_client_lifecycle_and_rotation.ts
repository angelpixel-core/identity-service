import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { ClientSecret } from '../../../../src/contexts/identity/domain/value_objects/client_secret/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';

const mockVerifier = {
  async compare(plain: string, hashed: string): Promise<boolean> {
    return hashed === `hash:${plain}`;
  },
};

describe('Unit: US-28 ClientApplication Lifecycle & Dual-Secret Rotation', () => {
  it('should reject rotateSecret on public clients with invalid_client_operation (400)', () => {
    const spaClient = ClientApplication.create({
      id: 'cli-spa-1',
      tenantId: 'acme-corp',
      clientId: ClientId.create('acme-spa'),
      clientName: 'Acme SPA',
      clientType: 'public',
      clientProfile: 'spa',
      allowedOrigins: [OriginDomain.create('https://app.acme-corp.com')],
      redirectUris: ['https://app.acme-corp.com/callback'],
      allowedGrantTypes: ['authorization_code'],
      scopes: ['openid'],
    });

    try {
      spaClient.rotateSecret('hash:new_secret_123456789012345678901234', 300);
      fail('Expected OAuth2AuthenticationError');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuth2AuthenticationError);
      expect((err as OAuth2AuthenticationError).errorCode).toBe('invalid_client_operation');
      expect((err as OAuth2AuthenticationError).statusCode).toBe(400);
    }
  });

  it('should accept both previous and new secret during dual-grace window and reject previous after expiry', async () => {
    const oldPlain = 'old_secret_12345678901234567890123456';
    const newPlain = 'new_secret_12345678901234567890123456';

    const m2m = ClientApplication.create({
      id: 'cli-m2m-1',
      tenantId: 'acme-corp',
      clientId: ClientId.create('acme-worker'),
      clientSecretHash: `hash:${oldPlain}`,
      clientName: 'Acme Worker',
      clientType: 'confidential',
      clientProfile: 'm2m',
      allowedOrigins: [OriginDomain.create('https://worker.acme-corp.com')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read'],
    });

    m2m.rotateSecret(`hash:${newPlain}`, 300);
    expect(m2m.getSecretGraceExpiresAt()).not.toBeNull();

    // Both secrets succeed within grace window
    await expect(
      m2m.validateClientCredentialsGrant(ClientSecret.create(oldPlain), mockVerifier)
    ).resolves.toBeUndefined();
    await expect(
      m2m.validateClientCredentialsGrant(ClientSecret.create(newPlain), mockVerifier)
    ).resolves.toBeUndefined();

    // Reconstitute with expired grace window -> old secret must be rejected
    const expired = ClientApplication.reconstitute({
      id: m2m.getId(),
      tenantId: m2m.getTenantId(),
      clientId: m2m.getClientId(),
      clientSecretHash: m2m.getClientSecretHash(),
      previousSecretHash: m2m.getPreviousSecretHash(),
      secretGraceExpiresAt: new Date(Date.now() - 5000),
      clientName: m2m.getClientName(),
      clientType: m2m.getClientType(),
      clientProfile: m2m.getClientProfile(),
      allowedOrigins: m2m.getAllowedOrigins(),
      redirectUris: m2m.getRedirectUris(),
      allowedGrantTypes: m2m.getAllowedGrantTypes(),
      scopes: m2m.getScopes(),
      status: 'active',
      createdAt: m2m.getCreatedAt(),
      updatedAt: m2m.getUpdatedAt(),
    });

    await expect(
      expired.validateClientCredentialsGrant(ClientSecret.create(oldPlain), mockVerifier)
    ).rejects.toThrow(/invalid client credentials/i);
    await expect(
      expired.validateClientCredentialsGrant(ClientSecret.create(newPlain), mockVerifier)
    ).resolves.toBeUndefined();
  });

  it('should block credentials grant when suspended and restore when reactivated', async () => {
    const secret = 'worker_secret_12345678901234567890123';
    const m2m = ClientApplication.create({
      id: 'cli-m2m-2',
      tenantId: 'acme-corp',
      clientId: ClientId.create('acme-worker-2'),
      clientSecretHash: `hash:${secret}`,
      clientName: 'Acme Worker 2',
      clientType: 'confidential',
      clientProfile: 'm2m',
      allowedOrigins: [OriginDomain.create('https://worker2.acme-corp.com')],
      redirectUris: [],
      allowedGrantTypes: ['client_credentials'],
      scopes: ['identity:read'],
    });

    m2m.suspend();
    expect(m2m.getStatus()).toBe('suspended');
    expect(m2m.isActive()).toBe(false);
    await expect(
      m2m.validateClientCredentialsGrant(ClientSecret.create(secret), mockVerifier)
    ).rejects.toThrow(/deactivated/i);

    m2m.reactivate();
    expect(m2m.getStatus()).toBe('active');
    expect(m2m.isActive()).toBe(true);
    await expect(
      m2m.validateClientCredentialsGrant(ClientSecret.create(secret), mockVerifier)
    ).resolves.toBeUndefined();
  });
});
