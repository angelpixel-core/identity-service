import util from 'util';
import { RefreshSession } from '../../../../../src/contexts/identity/domain/entities/refresh_session/aggregate';
import { DomainValidationError } from '../../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Domain Aggregate: RefreshSession (Sliding Session & Token Family Lifecycle)', () => {
  const validUserId = 'usr-test-123';
  const validTenantId = 'tenant-alpha';
  const validClientId = 'e-commerce-spa';

  describe('Creation and Factories', () => {
    it('should create a new active RefreshSession with default 30-day TTL', () => {
      const { session, plainToken } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });

      expect(session).toBeDefined();
      expect(session.getId()).toBeDefined();
      expect(session.getFamilyId()).toBeDefined();
      expect(session.getUserId()).toBe(validUserId);
      expect(session.getTenantId().getValue()).toBe(validTenantId);
      expect(session.getClientId().getValue()).toBe(validClientId);
      expect(session.getStatus()).toBe('active');
      expect(session.isActive()).toBe(true);
      expect(session.isConsumed()).toBe(false);
      expect(session.isRevoked()).toBe(false);
      expect(session.isExpired()).toBe(false);
      expect(plainToken).toHaveLength(64); // 32 bytes in hex
      expect(session.getTokenHash()).toHaveLength(64); // SHA-256 hex
    });

    it('should throw DomainValidationError when userId is empty or whitespace', () => {
      expect(() => {
        RefreshSession.create({
          userId: '   ',
          tenantId: validTenantId,
          clientId: validClientId,
        });
      }).toThrow(DomainValidationError);
    });

    it('should accept custom TTL and custom plain token', () => {
      const customPlain = 'custom_plain_refresh_token_value_32_chars';
      const { session, plainToken } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
        plainToken: customPlain,
        ttlDays: 7,
      });

      expect(plainToken).toBe(customPlain);
      expect(session.getTokenHash()).toBe(RefreshSession.hashToken(customPlain));
    });
  });

  describe('Cryptographic Hashing & Timing-Safe Verification', () => {
    it('should accurately compute SHA-256 hash for valid plain tokens', () => {
      const plain = 'a_secure_token_longer_than_16_chars';
      const hash = RefreshSession.hashToken(plain);
      expect(hash).toHaveLength(64);
      expect(RefreshSession.verifyHash(plain, hash)).toBe(true);
    });

    it('should throw DomainValidationError if token is empty or too short', () => {
      expect(() => RefreshSession.hashToken('')).toThrow(DomainValidationError);
      expect(() => RefreshSession.hashToken('short_token')).toThrow(DomainValidationError);
    });

    it('should return false via verifyHash when token does not match or is invalid', () => {
      const plain = 'a_secure_token_longer_than_16_chars';
      const hash = RefreshSession.hashToken(plain);

      expect(RefreshSession.verifyHash('different_token_longer_than_16_chars', hash)).toBe(false);
      expect(RefreshSession.verifyHash('', hash)).toBe(false);
      expect(RefreshSession.verifyHash(plain, 'invalid_length_hash')).toBe(false);
    });
  });

  describe('Rotation and Token Family Lifecycle', () => {
    it('should rotate session 1-to-1, marking parent consumed and creating active child with same familyId', () => {
      const { session } = RefreshSession.create({
        familyId: 'family-root-1',
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });

      const newChildPlain = RefreshSession.generatePlainToken();
      const newChildHash = RefreshSession.hashToken(newChildPlain);
      const now = new Date();

      const childSession = session.rotate(newChildHash, undefined, now);

      // Parent assertions
      expect(session.getStatus()).toBe('consumed');
      expect(session.isConsumed()).toBe(true);
      expect(session.isActive()).toBe(false);
      expect(session.getConsumedAt()).toEqual(now);

      // Child assertions
      expect(childSession.getId()).not.toBe(session.getId());
      expect(childSession.getFamilyId()).toBe('family-root-1');
      expect(childSession.getStatus()).toBe('active');
      expect(childSession.isActive()).toBe(true);
      expect(childSession.getTokenHash()).toBe(newChildHash);
    });

    it('should throw DomainValidationError when attempting to rotate an already consumed session (reuse detected)', () => {
      const { session } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });

      const childHash1 = RefreshSession.hashToken(RefreshSession.generatePlainToken());
      session.rotate(childHash1);

      const childHash2 = RefreshSession.hashToken(RefreshSession.generatePlainToken());
      expect(() => {
        session.rotate(childHash2);
      }).toThrow(DomainValidationError);
    });

    it('should throw DomainValidationError when attempting to rotate a revoked session', () => {
      const { session } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });
      session.revoke('user_logout');

      const childHash = RefreshSession.hashToken(RefreshSession.generatePlainToken());
      expect(() => {
        session.rotate(childHash);
      }).toThrow(DomainValidationError);
    });

    it('should detect expiration with custom clock and reject rotation of expired sessions', () => {
      const pastExpiresAt = new Date(Date.now() - 1000);
      const { session } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
        expiresAt: pastExpiresAt,
      });

      expect(session.isExpired()).toBe(true);
      expect(session.isActive()).toBe(false);

      const childHash = RefreshSession.hashToken(RefreshSession.generatePlainToken());
      expect(() => {
        session.rotate(childHash);
      }).toThrow(DomainValidationError);
    });
  });

  describe('Revocation and Observability Redaction', () => {
    it('should update status to revoked with reason and timestamp', () => {
      const { session } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });

      const now = new Date();
      session.revoke('security_violation', now);

      expect(session.getStatus()).toBe('revoked');
      expect(session.isRevoked()).toBe(true);
      expect(session.isActive()).toBe(false);
      expect(session.getRevocationReason()).toBe('security_violation');
      expect(session.getRevokedAt()).toEqual(now);
    });

    it('should redact secret tokenHash in toString and util.inspect', () => {
      const { session } = RefreshSession.create({
        userId: validUserId,
        tenantId: validTenantId,
        clientId: validClientId,
      });

      const str = session.toString();
      const inspected = util.inspect(session);

      expect(str).toContain('tokenHash=[REDACTED]');
      expect(inspected).toContain('tokenHash=[REDACTED]');
      expect(str).not.toContain(session.getTokenHash());
      expect(inspected).not.toContain(session.getTokenHash());
    });
  });
});

