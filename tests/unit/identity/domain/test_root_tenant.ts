import { User } from '../../../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

describe('Domain: Root Tenant & User Roles Governance (ADR-0009)', () => {
  const dummyEmail = Email.create('user@domain.com');
  const dummyHash = '$2b$12$dummyHashValue12345678901234567890';

  describe('Default Role Assignment (Backward Compatibility)', () => {
    it('should assign ["member"] by default when roles array is omitted in User.create', () => {
      const user = User.create({
        id: 'usr_reg_01',
        email: dummyEmail,
        tenantId: TenantId.create('acme-corp'),
        passwordHash: dummyHash,
      });

      expect(user.getRoles()).toEqual(['member']);
      expect(user.hasRole('member')).toBe(true);
      expect(user.hasRole('superadmin')).toBe(false);
      expect(user.isSuperadmin()).toBe(false);
    });

    it('should assign ["member"] when roles array is empty or contains only whitespace', () => {
      const user = User.create({
        id: 'usr_reg_02',
        email: dummyEmail,
        tenantId: TenantId.create('acme-corp'),
        passwordHash: dummyHash,
        roles: [],
      });

      expect(user.getRoles()).toEqual(['member']);
    });

    it('should assign ["member"] by default in createFederatedUser', () => {
      const fedUser = User.createFederatedUser({
        email: dummyEmail,
        tenantId: TenantId.create('acme-corp'),
      });

      expect(fedUser.getRoles()).toEqual(['member']);
      expect(fedUser.hasRole('member')).toBe(true);
      expect(fedUser.isSuperadmin()).toBe(false);
    });
  });

  describe('Root Tenant Superadmin Invariants (Zero-Trust Security)', () => {
    it('should identify superadmin ONLY when tenant is root AND has superadmin role', () => {
      const rootAdmin = User.create({
        id: 'usr_root_01',
        email: Email.create('admin@angelpixel.io'),
        tenantId: TenantId.root(),
        passwordHash: dummyHash,
        roles: ['superadmin'],
      });

      expect(rootAdmin.getTenantId().isRoot()).toBe(true);
      expect(rootAdmin.hasRole('superadmin')).toBe(true);
      expect(rootAdmin.isSuperadmin()).toBe(true);
    });

    it('should reject isSuperadmin() for client tenant users even if role "superadmin" was provided', () => {
      // Crucial defense-in-depth test: a client tenant user with 'superadmin' string
      // MUST NOT have global platform superadmin authority
      const rogueTenantUser = User.create({
        id: 'usr_rogue_01',
        email: Email.create('hacker@client-corp.com'),
        tenantId: TenantId.create('client-corp'),
        passwordHash: dummyHash,
        roles: ['superadmin'],
      });

      expect(rogueTenantUser.getTenantId().isRoot()).toBe(false);
      expect(rogueTenantUser.hasRole('superadmin')).toBe(true);
      // Domain invariant: isSuperadmin MUST be false!
      expect(rogueTenantUser.isSuperadmin()).toBe(false);
    });

    it('should return isSuperadmin() === false for root tenant user without superadmin role', () => {
      const rootMember = User.create({
        id: 'usr_root_guest',
        email: Email.create('guest@angelpixel.io'),
        tenantId: TenantId.root(),
        passwordHash: dummyHash,
        roles: ['auditor'],
      });

      expect(rootMember.getTenantId().isRoot()).toBe(true);
      expect(rootMember.hasRole('auditor')).toBe(true);
      expect(rootMember.hasRole('superadmin')).toBe(false);
      expect(rootMember.isSuperadmin()).toBe(false);
    });
  });

  describe('Role Normalization and Immutability', () => {
    it('should trim and lowercase role identifiers for robust comparison', () => {
      const user = User.create({
        id: 'usr_norm_01',
        email: dummyEmail,
        tenantId: TenantId.create('acme-corp'),
        passwordHash: dummyHash,
        roles: ['  SUPERADMIN  ', '  TENANT_ADMIN '],
      });

      expect(user.getRoles()).toEqual(['superadmin', 'tenant_admin']);
      expect(user.hasRole('superadmin')).toBe(true);
      expect(user.hasRole('SuperAdmin')).toBe(true);
      expect(user.hasRole('TENANT_ADMIN')).toBe(true);
      expect(user.hasRole('non_existent')).toBe(false);
      expect(user.hasRole('')).toBe(false);
    });

    it('should guarantee defensive immutability on getRoles()', () => {
      const user = User.create({
        id: 'usr_imm_01',
        email: dummyEmail,
        tenantId: TenantId.root(),
        passwordHash: dummyHash,
        roles: ['superadmin'],
      });

      const roles = user.getRoles();
      roles.push('injected_role');

      expect(user.getRoles()).toEqual(['superadmin']);
      expect(user.hasRole('injected_role')).toBe(false);
    });

    it('should reconstitute user with assigned roles correctly', () => {
      const reconstituted = User.reconstitute({
        id: 'usr_rec_01',
        email: dummyEmail,
        tenantId: TenantId.root(),
        passwordHash: dummyHash,
        roles: ['superadmin', 'platform_operator'],
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });

      expect(reconstituted.getRoles()).toEqual(['superadmin', 'platform_operator']);
      expect(reconstituted.isSuperadmin()).toBe(true);
    });
  });
});
