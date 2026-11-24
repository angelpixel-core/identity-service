import { WebAuthnCredential } from '../../../../src/contexts/identity/domain/entities/webauthn_credential/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Unit: US-35 WebAuthnCredential Domain Entity', () => {
  it('should create a valid WebAuthnCredential and protect publicKeyCose immutability', () => {
    const coseKey = Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26]);
    const cred = WebAuthnCredential.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'usr-101',
      tenantId: TenantId.create('acme-corp'),
      credentialId: 'cred-abc-123',
      publicKeyCose: coseKey,
      counter: 0,
      transports: ['internal', 'hybrid'],
      deviceType: 'multiDevice',
      backedUp: true,
    });

    expect(cred.getCredentialId()).toBe('cred-abc-123');
    expect(cred.getDeviceType()).toBe('multiDevice');
    expect(cred.isBackedUp()).toBe(true);
    expect(cred.getTransports()).toEqual(['internal', 'hybrid']);
    expect(cred.getPublicKeyCose().equals(coseKey)).toBe(true);
  });

  it('should reject empty credentialId or empty publicKeyCose', () => {
    expect(() =>
      WebAuthnCredential.create({
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'usr-101',
        tenantId: TenantId.create('acme-corp'),
        credentialId: '',
        publicKeyCose: Buffer.from([1, 2, 3]),
      })
    ).toThrow(DomainValidationError);

    expect(() =>
      WebAuthnCredential.create({
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'usr-101',
        tenantId: TenantId.create('acme-corp'),
        credentialId: 'cred-1',
        publicKeyCose: Buffer.alloc(0),
      })
    ).toThrow(DomainValidationError);
  });

  it('should enforce counter monotonicity and detect counter regression', () => {
    const cred = WebAuthnCredential.create({
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'usr-101',
      tenantId: TenantId.create('acme-corp'),
      credentialId: 'cred-counter-1',
      publicKeyCose: Buffer.from([1, 2, 3]),
      counter: 5,
    });

    cred.updateCounter(6);
    expect(cred.getCounter()).toBe(6);

    expect(() => cred.updateCounter(6)).toThrow(DomainValidationError);
    expect(() => cred.updateCounter(4)).toThrow(DomainValidationError);
  });
});
