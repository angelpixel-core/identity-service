import { TenantFederatedProvider } from '../../../../src/contexts/identity/domain/entities/tenant_federated_provider/entity';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';
import { ExternalIdentityProviderPort } from '../../../../src/contexts/identity/domain/ports/external_identity_provider_port';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { CompositeTenantFederatedProvidersAdapter } from '../../../../src/contexts/identity/application/ports/federation/tenant_federated_providers_port';
import { InMemoryTenantFederatedProviderRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_federated_provider/in_memory_repository';
import { AesGcmSecretCipher } from '../../../../src/contexts/identity/infrastructure/security/aes_gcm_secret_cipher';

describe('Unit: US-33 TenantFederatedProvider, AesGcmSecretCipher & CompositePort', () => {
  it('should normalize providerKey, validate HTTPS issuerUrl and omit secret in toSafeDto()', () => {
    const provider = TenantFederatedProvider.create({
      id: 'idp-001',
      tenantId: TenantId.create('acme-corp'),
      providerKey: '  Okta-Corp  ',
      displayName: 'Okta Corporate',
      protocol: 'oidc',
      issuerUrl: 'https://acme.okta.com/oauth2/default',
      clientId: 'okta-client-01',
      encryptedClientSecret: 'v1:iv:tag:cipher',
      scopes: ['openid', 'email', 'openid'],
    });

    expect(provider.getProviderKey()).toBe('okta-corp');
    expect(provider.getScopes()).toEqual(['openid', 'email']);

    const dto = provider.toSafeDto();
    expect(dto.hasClientSecret).toBe(true);
    expect((dto as unknown as Record<string, unknown>).encryptedClientSecret).toBeUndefined();
    expect((dto as unknown as Record<string, unknown>).clientSecret).toBeUndefined();

    expect(() =>
      TenantFederatedProvider.create({
        id: 'idp-002',
        tenantId: TenantId.create('acme-corp'),
        providerKey: 'okta-corp',
        displayName: 'Okta Insecure',
        protocol: 'oidc',
        issuerUrl: 'http://acme.okta.com/oauth2/default',
        clientId: 'okta-client-01',
        encryptedClientSecret: 'v1:iv:tag:cipher',
      })
    ).toThrow(DomainValidationError);
  });

  it('should encrypt with random IV and fail decryption when auth tag is tampered', () => {
    const cipher = new AesGcmSecretCipher('unit_test_master_key_32_bytes_long!');
    const rawSecret = 'super_secret_okta_client_value_2026';
    const enc1 = cipher.encrypt(rawSecret);
    const enc2 = cipher.encrypt(rawSecret);

    expect(enc1).not.toBe(enc2);
    expect(enc1.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(enc1)).toBe(rawSecret);
    expect(cipher.decrypt(enc2)).toBe(rawSecret);

    const parts = enc1.split(':');
    const tamperedTag = Buffer.from(parts[2]!, 'base64');
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;
    const tampered = [parts[0], parts[1], tamperedTag.toString('base64'), parts[3]].join(':');

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('should merge default global providers and enabled tenant providers without exposing secrets', async () => {
    const repo = new InMemoryTenantFederatedProviderRepository();
    await repo.save(
      TenantFederatedProvider.create({
        id: 'idp-003',
        tenantId: TenantId.create('acme-corp'),
        providerKey: 'slack',
        displayName: 'Slack Workspace',
        protocol: 'oauth2',
        issuerUrl: 'https://slack.com',
        clientId: 'slack-cid',
        encryptedClientSecret: 'v1:iv:tag:cipher',
        enabled: true,
      })
    );

    const defaultGoogle = { providerId: 'google' } as ExternalIdentityProviderPort;
    const composite = new CompositeTenantFederatedProvidersAdapter([defaultGoogle], repo);

    const acmeProviders = await composite.listForTenant('acme-corp');
    expect(acmeProviders).toEqual([
      { id: 'google', displayName: 'Google', protocol: 'oidc' },
      { id: 'slack', displayName: 'Slack Workspace', protocol: 'oauth2' },
    ]);

    const otherProviders = await composite.listForTenant('beta-corp');
    expect(otherProviders).toEqual([{ id: 'google', displayName: 'Google', protocol: 'oidc' }]);
  });
});
