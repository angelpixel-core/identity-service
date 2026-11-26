import { FederatedIdentity } from '../../../../../src/contexts/identity/domain/entities/federated_identity/aggregate';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { Email } from '../../../../../src/contexts/identity/domain/value_objects/email/value';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Aggregate Root: FederatedIdentity (US-11 Unit)', () => {
  const validTenantId = TenantId.create('alpha-corp');
  const validEmail = Email.create('alice.external@company.com');
  const validUserId = 'usr-12345-local';
  const validSubject = 'google-sub-987654321';

  describe('Creation & Reconstitution', () => {
    it('should successfully create a new FederatedIdentity aggregate with value objects', () => {
      const identity = FederatedIdentity.create({
        userId: validUserId,
        tenantId: validTenantId,
        provider: 'google',
        externalSubjectId: validSubject,
        externalEmail: validEmail,
      });

      expect(identity.getId()).toBeDefined();
      expect(identity.getId().length).toBeGreaterThan(10);
      expect(identity.getUserId()).toBe(validUserId);
      expect(identity.getTenantId().equals(validTenantId)).toBe(true);
      expect(identity.getProvider()).toBe('google');
      expect(identity.getExternalSubjectId()).toBe(validSubject);
      expect(identity.getExternalEmail().equals(validEmail)).toBe(true);
      expect(identity.getCreatedAt()).toBeInstanceOf(Date);
      expect(identity.getUpdatedAt()).toBeInstanceOf(Date);
    });

    it('should support string primitives for tenantId and externalEmail in factory', () => {
      const identity = FederatedIdentity.create({
        userId: validUserId,
        tenantId: 'beta-corp',
        provider: 'microsoft',
        externalSubjectId: 'ms-oid-112233',
        externalEmail: 'bob@enterprise.onmicrosoft.com',
      });

      expect(identity.getTenantId().getValue()).toBe('beta-corp');
      expect(identity.getProvider()).toBe('microsoft');
      expect(identity.getExternalEmail().getValue()).toBe('bob@enterprise.onmicrosoft.com');
    });

    it('should accept a custom id if provided during creation', () => {
      const customId = 'fed-id-custom-001';
      const identity = FederatedIdentity.create({
        id: customId,
        userId: validUserId,
        tenantId: validTenantId,
        provider: 'google',
        externalSubjectId: validSubject,
        externalEmail: validEmail,
      });

      expect(identity.getId()).toBe(customId);
    });

    it('should reconstitute an existing FederatedIdentity from database snapshot', () => {
      const pastDate = new Date('2026-02-15T10:00:00Z');
      const identity = FederatedIdentity.reconstitute({
        id: 'fed-rec-001',
        userId: validUserId,
        tenantId: validTenantId,
        provider: 'google',
        externalSubjectId: validSubject,
        externalEmail: validEmail,
        createdAt: pastDate,
        updatedAt: pastDate,
      });

      expect(identity.getId()).toBe('fed-rec-001');
      expect(identity.getCreatedAt()).toEqual(pastDate);
      expect(identity.getUpdatedAt()).toEqual(pastDate);
    });
  });

  describe('Validation & Invariants', () => {
    it('should throw DomainValidationError if id is empty', () => {
      expect(() =>
        FederatedIdentity.reconstitute({
          id: '',
          userId: validUserId,
          tenantId: validTenantId,
          provider: 'google',
          externalSubjectId: validSubject,
          externalEmail: validEmail,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      ).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if userId is empty or whitespace', () => {
      expect(() =>
        FederatedIdentity.create({
          userId: '   ',
          tenantId: validTenantId,
          provider: 'google',
          externalSubjectId: validSubject,
          externalEmail: validEmail,
        })
      ).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if provider is empty or whitespace', () => {
      expect(() =>
        FederatedIdentity.create({
          userId: validUserId,
          tenantId: validTenantId,
          provider: '   ' as any,
          externalSubjectId: validSubject,
          externalEmail: validEmail,
        })
      ).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if externalSubjectId is empty or whitespace', () => {
      expect(() =>
        FederatedIdentity.create({
          userId: validUserId,
          tenantId: validTenantId,
          provider: 'google',
          externalSubjectId: '  ',
          externalEmail: validEmail,
        })
      ).toThrow(DomainValidationError);
    });
  });

  describe('Domain Business Methods', () => {
    const identityA = FederatedIdentity.create({
      id: 'fed-1',
      userId: validUserId,
      tenantId: validTenantId,
      provider: 'google',
      externalSubjectId: validSubject,
      externalEmail: validEmail,
    });

    it('equals should return true for identical provider and external subject', () => {
      const identityB = FederatedIdentity.create({
        id: 'fed-2',
        userId: 'different-local-user',
        tenantId: validTenantId,
        provider: 'google',
        externalSubjectId: validSubject,
        externalEmail: validEmail,
      });

      expect(identityA.equals(identityB)).toBe(true);
    });

    it('equals should return false for different provider or subject', () => {
      const identityDiffSubject = FederatedIdentity.create({
        userId: validUserId,
        tenantId: validTenantId,
        provider: 'google',
        externalSubjectId: 'other-sub-000',
        externalEmail: validEmail,
      });

      const identityDiffProvider = FederatedIdentity.create({
        userId: validUserId,
        tenantId: validTenantId,
        provider: 'microsoft',
        externalSubjectId: validSubject,
        externalEmail: validEmail,
      });

      expect(identityA.equals(identityDiffSubject)).toBe(false);
      expect(identityA.equals(identityDiffProvider)).toBe(false);
      expect(identityA.equals(null)).toBe(false);
      expect(identityA.equals({} as any)).toBe(false);
    });

    it('matchesSubject should accurately compare provider and externalSubjectId', () => {
      expect(identityA.matchesSubject('google', validSubject)).toBe(true);
      expect(identityA.matchesSubject('google', ` ${validSubject} `)).toBe(true);
      expect(identityA.matchesSubject('microsoft', validSubject)).toBe(false);
      expect(identityA.matchesSubject('google', 'mismatched-subject')).toBe(false);
    });

    it('belongsToTenant should verify tenant matching', () => {
      expect(identityA.belongsToTenant(validTenantId)).toBe(true);
      expect(identityA.belongsToTenant(TenantId.create('other-corp'))).toBe(false);
    });
  });
});
