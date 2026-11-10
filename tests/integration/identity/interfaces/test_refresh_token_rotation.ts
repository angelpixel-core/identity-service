import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryRefreshSessionRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { RsaKeyAdapter } from '../../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { RefreshSession } from '../../../../src/contexts/identity/domain/entities/refresh_session/aggregate';

describe('Integration API: Sliding Session Refresh Token Rotation & Cookie Management (US-09)', () => {
  let app: Express;
  let clientRepository: InMemoryClientApplicationRepository;
  let sessionRepository: InMemoryRefreshSessionRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let asymmetricKeyProvider: RsaKeyAdapter;

  beforeEach(() => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    sessionRepository = new InMemoryRefreshSessionRepository();
    auditLogger = new InMemorySecurityAuditLogger();
    asymmetricKeyProvider = new RsaKeyAdapter();

    app = createApp({
      clientRepository,
      refreshSessionRepository: sessionRepository,
      auditLogger,
      asymmetricKeyProvider,
    });
  });

  describe('POST /oauth2/refresh & POST /api/v1/oauth2/refresh', () => {
    it('should successfully rotate refresh token delivered via HttpOnly Cookie', async () => {
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-integration-1',
        userId: 'user-int-1',
        tenantId: 'tenant-acme',
        clientId: 'e-commerce-spa',
      });
      await sessionRepository.save(session);

      const res = await request(app)
        .post('/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBe(900);

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
      expect(cookieHeader).toMatch(/refresh_token=/i);
      expect(cookieHeader).toMatch(/HttpOnly/i);
      expect(cookieHeader).toMatch(/SameSite=Strict/i);

      // Verify old session is marked as consumed
      const oldSession = await sessionRepository.findByTokenHash(session.getTokenHash());
      expect(oldSession?.isConsumed()).toBe(true);
    });

    it('should set Path=/api/v1/oauth2 when requested on /api/v1/oauth2/refresh', async () => {
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-integration-v1',
        userId: 'user-int-v1',
        tenantId: 'tenant-acme',
        clientId: 'e-commerce-spa',
      });
      await sessionRepository.save(session);

      const res = await request(app)
        .post('/api/v1/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      expect(res.status).toBe(200);
      const setCookie = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
      expect(cookieHeader).toMatch(/Path=\/api\/v1\/oauth2/i);
    });

    it('should reject with 400 invalid_request when no refresh token is provided', async () => {
      const res = await request(app).post('/oauth2/refresh').send();

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('should reject with 401 invalid_grant when refresh token is unknown', async () => {
      const res = await request(app)
        .post('/oauth2/refresh')
        .set('Cookie', ['refresh_token=non_existent_token_string_1234567890'])
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_grant');
    });

    it('should detect reuse of consumed token and revoke all tokens in the family', async () => {
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-reuse-test',
        userId: 'user-victim',
        tenantId: 'tenant-acme',
        clientId: 'e-commerce-spa',
      });

      // 1. First rotation (valid)
      const childPlain = RefreshSession.generatePlainToken();
      const childSession = session.rotate(RefreshSession.hashToken(childPlain));
      await sessionRepository.save(session);
      await sessionRepository.save(childSession);

      // 2. Attacker replays consumed token
      const res = await request(app)
        .post('/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_grant');
      expect(res.body.error_description).toMatch(/compromised/i);

      // Verify all family tokens are revoked
      const family = await sessionRepository.findByFamilyId('fam-reuse-test');
      expect(family.length).toBe(2);
      expect(family.every((s) => s.isRevoked())).toBe(true);

      // Verify security audit log
      const events = await auditLogger.getEvents();
      const reuseEvent = events.find((e) => e.eventType === 'refresh_token_reuse_detected');
      expect(reuseEvent).toBeDefined();
    });
  });

  describe('POST /oauth2/token with grant_type=refresh_token (RFC 6749)', () => {
    it('should rotate token via RFC 6749 body parameters', async () => {
      const plainToken = 'rfc_body_refresh_token_12345';
      const { session } = RefreshSession.create({
        familyId: 'fam-rfc-body',
        userId: 'user-rfc',
        tenantId: 'tenant-acme',
        clientId: 'e-commerce-spa',
        plainToken,
      });
      await sessionRepository.save(session);

      const res = await request(app)
        .post('/oauth2/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: plainToken,
        });

      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.refresh_token).not.toBe(plainToken);
    });
  });

  describe('POST /oauth2/revoke (RFC 7009 / Logout)', () => {
    it('should revoke session and clear refresh_token cookie with Max-Age 0', async () => {
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-revoke-1',
        userId: 'user-logout',
        tenantId: 'tenant-acme',
        clientId: 'e-commerce-spa',
      });
      await sessionRepository.save(session);

      const res = await request(app)
        .post('/oauth2/revoke')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/revoked/i);

      const setCookie = res.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
      expect(cookieHeader).toMatch(/Max-Age=0/i);

      // Subsequent refresh with revoked token must fail
      const refreshRes = await request(app)
        .post('/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error).toBe('invalid_grant');
    });
  });
});

