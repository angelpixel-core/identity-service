import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
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

  describe('Root Tenant Recognition (ADR-0009)', () => {
    it('should provide canonical ROOT_TENANT_ID as "system"', () => {
      expect(TenantId.ROOT_TENANT_ID).toBe('system');
    });

    it('should instantiate Root Tenant via TenantId.root() factory', () => {
      const rootTenant = TenantId.root();
      expect(rootTenant.getValue()).toBe('system');
      expect(rootTenant.isRoot()).toBe(true);
    });

    it('should identify Root Tenant when created with "system"', () => {
      const tenant = TenantId.create('system');
      expect(tenant.isRoot()).toBe(true);
    });

    it('should return false for isRoot() on regular client tenants', () => {
      expect(TenantId.create('acme-corp').isRoot()).toBe(false);
      expect(TenantId.create('globex-corp').isRoot()).toBe(false);
      expect(TenantId.create('system-other').isRoot()).toBe(false);
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

