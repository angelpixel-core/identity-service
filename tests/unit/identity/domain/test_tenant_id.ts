// Intentionally importing Value Objects to test before implementation (TDD RED)
// @ts-expect-error - Module will be created in src/contexts/identity/domain/value_objects/tenant_id/value.ts
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
// @ts-expect-error - Module will be created in src/contexts/identity/domain/exceptions/user/error.ts
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Value Object: TenantId', () => {
  describe('Valid TenantId Instantiation', () => {
    it('should create a TenantId instance for valid slug string', () => {
      const tenantId = TenantId.create('acme-corp');
      expect(tenantId.getValue()).toBe('acme-corp');
    });

    it('should trim whitespace and keep valid casing', () => {
      const tenantId = TenantId.create('  tenant-123  ');
      expect(tenantId.getValue()).toBe('tenant-123');
    });

    it('should correctly evaluate value equality with equals()', () => {
      const tenantId1 = TenantId.create('tenant-a');
      const tenantId2 = TenantId.create('tenant-a');
      const tenantId3 = TenantId.create('tenant-b');

      expect(tenantId1.equals(tenantId2)).toBe(true);
      expect(tenantId1.equals(tenantId3)).toBe(false);
    });
  });

  describe('Invalid TenantId Validation (Defensive Failures)', () => {
    it('should throw DomainValidationError for empty string or whitespace', () => {
      expect(() => TenantId.create('')).toThrow(DomainValidationError);
      expect(() => TenantId.create('   ')).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if tenantId contains invalid special characters', () => {
      expect(() => TenantId.create('tenant/invalid')).toThrow(DomainValidationError);
      expect(() => TenantId.create('tenant:invalid')).toThrow(DomainValidationError);
    });
  });
});
