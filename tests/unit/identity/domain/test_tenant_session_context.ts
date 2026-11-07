import { TenantSessionContext } from '../../../../src/contexts/identity/domain/value_objects/tenant_session_context/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';
import { CrossTenantContextViolationError } from '../../../../src/contexts/identity/domain/exceptions/security/error';

describe('Value Object: TenantSessionContext (ADR-0005 & US-05 Refactoring)', () => {
  const validTenantSlug = 'alpha-corp';
  const tenantVo = TenantId.create(validTenantSlug);

  describe('Instantiation and Value Encapsulation', () => {
    it('should create TenantSessionContext from a valid string', () => {
      const context = TenantSessionContext.create(validTenantSlug);

      expect(context).toBeInstanceOf(TenantSessionContext);
      expect(context.getTenantIdValue()).toBe(validTenantSlug);
      expect(context.getTenantId().getValue()).toBe(validTenantSlug);
    });

    it('should create TenantSessionContext from a TenantId Value Object', () => {
      const context = TenantSessionContext.create(tenantVo);

      expect(context).toBeInstanceOf(TenantSessionContext);
      expect(context.getTenantId().equals(tenantVo)).toBe(true);
      expect(context.getTenantIdValue()).toBe(validTenantSlug);
    });

    it('should guarantee immutability by freezing the context instance', () => {
      const context = TenantSessionContext.create(validTenantSlug);

      expect(Object.isFrozen(context)).toBe(true);
      expect(() => {
        (context as any).tenantId = TenantId.create('mutated-tenant');
      }).toThrow();
    });

    it('should return a readable representation with toString()', () => {
      const context = TenantSessionContext.create('beta-solutions');

      expect(context.toString()).toBe('TenantSessionContext(beta-solutions)');
    });
  });

  describe('Validation Invariants', () => {
    it('should throw DomainValidationError if tenantId is null or undefined', () => {
      expect(() => TenantSessionContext.create(null as any)).toThrow(DomainValidationError);
      expect(() => TenantSessionContext.create(undefined as any)).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError if tenantId is empty string or only whitespace', () => {
      expect(() => TenantSessionContext.create('')).toThrow(DomainValidationError);
      expect(() => TenantSessionContext.create('   ')).toThrow(DomainValidationError);
    });

    it('should reject invalid tenant characters by delegating to TenantId rules', () => {
      expect(() => TenantSessionContext.create('invalid tenant with spaces')).toThrow(DomainValidationError);
      expect(() => TenantSessionContext.create('evil$tenant%')).toThrow(DomainValidationError);
    });
  });

  describe('Equality Comparison (equals)', () => {
    it('should return true for identical tenant contexts', () => {
      const context1 = TenantSessionContext.create('org-xyz');
      const context2 = TenantSessionContext.create('org-xyz');

      expect(context1.equals(context2)).toBe(true);
    });

    it('should return false for different tenant contexts', () => {
      const context1 = TenantSessionContext.create('org-alpha');
      const context2 = TenantSessionContext.create('org-beta');

      expect(context1.equals(context2)).toBe(false);
    });

    it('should return false when comparing against null, undefined, or non-TenantSessionContext objects', () => {
      const context = TenantSessionContext.create('org-alpha');

      expect(context.equals(null)).toBe(false);
      expect(context.equals(undefined)).toBe(false);
      expect(context.equals({ tenantId: 'org-alpha' })).toBe(false);
      expect(context.equals(TenantId.create('org-alpha'))).toBe(false);
    });
  });

  describe('Cross-Tenant Assertion (assertMatchingTenant)', () => {
    it('should succeed silently when target tenant matches active session context (string and TenantId)', () => {
      const context = TenantSessionContext.create('acme-corp');

      expect(() => context.assertMatchingTenant('acme-corp')).not.toThrow();
      expect(() => context.assertMatchingTenant(TenantId.create('acme-corp'))).not.toThrow();
    });

    it('should throw CrossTenantContextViolationError when target tenant differs from active session', () => {
      const context = TenantSessionContext.create('acme-corp');

      try {
        context.assertMatchingTenant('evil-corp');
        fail('Expected CrossTenantContextViolationError to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(CrossTenantContextViolationError);
        expect(error.code).toBe('cross_tenant_context_violation');
        expect(error.activeTenantId).toBe('acme-corp');
        expect(error.attemptedTenantId).toBe('evil-corp');
        expect(error.message).toContain("active tenant 'acme-corp' cannot execute operations for target tenant 'evil-corp'");
      }
    });

    it('should throw DomainValidationError if target tenant is empty or null', () => {
      const context = TenantSessionContext.create('acme-corp');

      expect(() => context.assertMatchingTenant('')).toThrow(DomainValidationError);
      expect(() => context.assertMatchingTenant(null as any)).toThrow(DomainValidationError);
    });
  });
});

