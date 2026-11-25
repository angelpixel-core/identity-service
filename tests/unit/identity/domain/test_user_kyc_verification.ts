import { UserKycVerification } from '../../../../src/contexts/identity/domain/entities/kyc_verification/entity';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Unit: US-37 UserKycVerification State Machine & Expiration', () => {
  it('should transition UNVERIFIED -> PENDING -> VERIFIED and project JWT claims accurately', () => {
    const kyc = UserKycVerification.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'usr-101',
      tenantId: TenantId.create('tusherramientas-a'),
    });

    expect(kyc.getStatus()).toBe('UNVERIFIED');
    expect(kyc.toJwtClaims()).toEqual({ kyc_verified: false, kyc_status: 'UNVERIFIED' });

    kyc.startSession('biometric_liveness', 'kyc_ref_01');
    expect(kyc.getStatus()).toBe('PENDING');
    expect(kyc.getLevel()).toBe('biometric_liveness');
    expect(kyc.toJwtClaims()).toEqual({ kyc_verified: false, kyc_status: 'PENDING' });

    const future = new Date(Date.now() + 60_000);
    kyc.markVerified(future);
    expect(kyc.getStatus()).toBe('VERIFIED');
    expect(kyc.isCurrentlyVerified()).toBe(true);
    expect(kyc.toJwtClaims()).toEqual({ kyc_verified: true, kyc_status: 'VERIFIED' });
  });

  it('should treat expired VERIFIED record as unverified in toJwtClaims()', () => {
    const past = new Date(Date.now() - 60_000);
    const kyc = UserKycVerification.reconstitute({
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'usr-102',
      tenantId: TenantId.create('tusherramientas-a'),
      status: 'VERIFIED',
      level: 'biometric_liveness',
      providerRef: 'kyc_ref_02',
      verifiedAt: new Date(Date.now() - 120_000),
      expiresAt: past,
    });

    expect(kyc.isCurrentlyVerified()).toBe(false);
    expect(kyc.toJwtClaims()).toEqual({ kyc_verified: false, kyc_status: 'UNVERIFIED' });
  });

  it('should transition to REJECTED and reject empty providerRef on startSession', () => {
    const kyc = UserKycVerification.create({
      id: '33333333-3333-4333-8333-333333333333',
      userId: 'usr-103',
      tenantId: TenantId.create('tusherramientas-a'),
    });

    expect(() => kyc.startSession('basic', '')).toThrow(DomainValidationError);
    kyc.startSession('basic', 'kyc_ref_03');
    kyc.markRejected();
    expect(kyc.toJwtClaims()).toEqual({ kyc_verified: false, kyc_status: 'REJECTED' });
  });
});
