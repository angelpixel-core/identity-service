import {
  InvalidTenantPolicyError,
  TenantPolicy,
} from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Unit: US-30 TenantPolicy Domain Aggregate', () => {
  it('should provide a safe default policy via defaultFor() when no custom policy is persisted', () => {
    const policy = TenantPolicy.defaultFor(TenantId.create('acme-corp'));

    expect(policy.getTenantId().getValue()).toBe('acme-corp');
    expect(policy.getUpdatedBy()).toBe('system-default');
    expect(policy.getRequiredAttributes()).toEqual({ phone: false });
    expect(policy.getKycPolicy()).toEqual({ required: false, minLevel: 'basic' });
    expect(policy.getAllowedAuthMethods()).toEqual({
      password: true,
      passkeys: false,
      federatedOidc: true,
    });
  });

  it('should create and update a custom TenantPolicy with valid invariants', () => {
    const policy = TenantPolicy.create({
      tenantId: TenantId.create('  acme-corp  '),
      requiredAttributes: { phone: true },
      kycPolicy: { required: true, minLevel: 'biometric_liveness' },
      allowedAuthMethods: { password: true, passkeys: false, federatedOidc: true },
      updatedBy: 'admin@acme-corp.com',
    });

    expect(policy.getTenantId().getValue()).toBe('acme-corp');
    expect(policy.getRequiredAttributes()).toEqual({ phone: true });
    expect(policy.getKycPolicy()).toEqual({ required: true, minLevel: 'biometric_liveness' });
    expect(policy.getAllowedAuthMethods()).toEqual({
      password: true,
      passkeys: false,
      federatedOidc: true,
    });
    expect(policy.getUpdatedBy()).toBe('admin@acme-corp.com');

    policy.update({
      requiredAttributes: { phone: false },
      kycPolicy: { required: true, minLevel: 'basic' },
      allowedAuthMethods: { password: false, passkeys: true, federatedOidc: false },
      updatedBy: 'root@angelpixel.io',
    });

    expect(policy.getRequiredAttributes()).toEqual({ phone: false });
    expect(policy.getKycPolicy()).toEqual({ required: true, minLevel: 'basic' });
    expect(policy.getAllowedAuthMethods()).toEqual({
      password: false,
      passkeys: true,
      federatedOidc: false,
    });
    expect(policy.getUpdatedBy()).toBe('root@angelpixel.io');
  });

  it('should reject creating or updating a TenantPolicy with all authentication methods disabled', () => {
    expect(() =>
      TenantPolicy.create({
        tenantId: TenantId.create('acme-corp'),
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: false },
        updatedBy: 'admin@acme-corp.com',
      })
    ).toThrow(InvalidTenantPolicyError);

    const policy = TenantPolicy.defaultFor(TenantId.create('acme-corp'));
    expect(() =>
      policy.update({
        allowedAuthMethods: { password: false, passkeys: false, federatedOidc: false },
        updatedBy: 'admin@acme-corp.com',
      })
    ).toThrow(InvalidTenantPolicyError);
  });

  it('should reconstitute a persisted policy accurately', () => {
    const now = new Date('2026-11-24T12:00:00.000Z');
    const policy = TenantPolicy.reconstitute({
      tenantId: TenantId.create('globex'),
      requiredAttributes: { phone: true },
      kycPolicy: { required: false, minLevel: 'basic' },
      allowedAuthMethods: { password: true, passkeys: true, federatedOidc: false },
      updatedAt: now,
      updatedBy: 'admin@globex.com',
    });

    expect(policy.getTenantId().getValue()).toBe('globex');
    expect(policy.getUpdatedAt()).toEqual(now);
    expect(policy.getUpdatedBy()).toBe('admin@globex.com');
  });
});
