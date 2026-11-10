import http from 'http';
import request from 'supertest';
import { Express } from 'express';
import { createApp } from '../../../interfaces/http/server';
import { InMemoryClientApplicationRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryRefreshSessionRepository } from '../../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { InMemorySecurityAuditLogger } from '../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { RsaKeyAdapter } from '../../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { RefreshSession } from '../../../src/contexts/identity/domain/entities/refresh_session/aggregate';

describe('Feature: Sliding Session Refresh Token Rotation with HttpOnly Cookies (US-09)', () => {
  let app: Express;
  let server: http.Server;
  let clientRepository: InMemoryClientApplicationRepository;
  let refreshSessionRepository: InMemoryRefreshSessionRepository;
  let auditLogger: InMemorySecurityAuditLogger;
  let asymmetricKeyProvider: RsaKeyAdapter;

  beforeEach((done) => {
    clientRepository = new InMemoryClientApplicationRepository(true);
    refreshSessionRepository = new InMemoryRefreshSessionRepository();
    auditLogger = new InMemorySecurityAuditLogger();
    asymmetricKeyProvider = new RsaKeyAdapter();

    app = createApp({
      clientRepository,
      refreshSessionRepository,
      auditLogger,
      asymmetricKeyProvider,
    });
    server = http.createServer(app);
    server.listen(0, done);
  });

  afterEach((done) => {
    if (server) {
      server.closeAllConnections?.();
      server.close(done);
    } else {
      done();
    }
  });

  describe('Scenario: Successful refresh token rotation with HttpOnly cookie', () => {
    it('should rotate the refresh token and set new HttpOnly SameSite=Strict cookie', async () => {
      // Given an active session with valid refresh token cookie belonging to family "fam-100"
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-100',
        userId: 'usr-rot-1',
        tenantId: 'tenant-alpha',
        clientId: 'e-commerce-spa',
      });
      await refreshSessionRepository.save(session);

      // When the client sends a POST request to "/oauth2/refresh"
      const res = await request(server)
        .post('/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      // Then the response status code should be 200 OK
      expect(res.status).toBe(200);

      // And a new access_token should be returned in the response body
      expect(res.body.access_token).toBeDefined();
      expect(res.body.token_type).toBe('Bearer');
      expect(typeof res.body.expires_in).toBe('number');

      // And a new refresh_token cookie with "HttpOnly" and "SameSite=Strict" should be set
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
      expect(cookieStr).toMatch(/refresh_token=[a-f0-9]{64}/i);
      expect(cookieStr).toMatch(/HttpOnly/i);
      expect(cookieStr).toMatch(/SameSite=Strict/i);

      // And the previous refresh token should be marked as consumed
      const previousSession = await refreshSessionRepository.findByTokenHash(session.getTokenHash());
      expect(previousSession).not.toBeNull();
      expect(previousSession!.isConsumed()).toBe(true);
    });
  });

  describe('Scenario: Detection of token reuse and complete family revocation', () => {
    it('should detect reuse, reject with 401, revoke entire family, and log security alert', async () => {
      // Given a previously consumed refresh token from family "fam-100"
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-100',
        userId: 'usr-victim',
        tenantId: 'tenant-alpha',
        clientId: 'e-commerce-spa',
      });

      // Simulate prior rotation: old session is consumed and active child session exists
      const newPlainChild = RefreshSession.generatePlainToken();
      const childSession = session.rotate(RefreshSession.hashToken(newPlainChild));
      await refreshSessionRepository.save(session);
      await refreshSessionRepository.save(childSession);

      // When an attacker attempts to replay this consumed token at "/oauth2/refresh"
      const res = await request(server)
        .post('/oauth2/refresh')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      // Then the system should reject the request with HTTP 401 Unauthorized
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_grant');

      // And all tokens associated with family "fam-100" should be immediately revoked
      const familySessions = await refreshSessionRepository.findByFamilyId('fam-100');
      expect(familySessions.length).toBeGreaterThanOrEqual(2);
      for (const s of familySessions) {
        expect(s.isRevoked()).toBe(true);
      }

      // And a security alert "REFRESH_TOKEN_REUSE_DETECTED" should be emitted
      const events = await auditLogger.getEvents();
      const reuseEvent = events.find((e) => e.eventType === 'refresh_token_reuse_detected');
      expect(reuseEvent).toBeDefined();
      expect(reuseEvent?.metadata?.familyId).toBe('fam-100');
    });
  });

  describe('Scenario: Successful token rotation via standard RFC 6749 request body', () => {
    it('should rotate token via POST /oauth2/token with grant_type=refresh_token', async () => {
      // Given an active session with valid refresh token "active_plain_rt_string_123" belonging to family "fam-200"
      const plainToken = 'active_plain_rt_string_123';
      const { session } = RefreshSession.create({
        familyId: 'fam-200',
        userId: 'usr-rfc-2',
        tenantId: 'tenant-alpha',
        clientId: 'e-commerce-spa',
        plainToken,
      });
      await refreshSessionRepository.save(session);

      // When the client sends a POST request to "/oauth2/token" with grant_type "refresh_token" and refresh_token
      const res = await request(server)
        .post('/oauth2/token')
        .send({
          grant_type: 'refresh_token',
          refresh_token: plainToken,
          client_id: 'e-commerce-spa',
        });

      // Then the response status code should be 200 OK
      expect(res.status).toBe(200);

      // And the response body should contain "access_token" and "refresh_token"
      expect(res.body.access_token).toBeDefined();
      expect(res.body.refresh_token).toBeDefined();
      expect(res.body.refresh_token).not.toBe(plainToken);

      // And a new refresh_token cookie should also be set
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
    });
  });

  describe('Scenario: Explicit session revocation and cookie cleanup (Logout)', () => {
    it('should revoke session and clear cookie with Max-Age 0', async () => {
      // Given an active session with valid refresh token cookie belonging to family "fam-300"
      const { session, plainToken } = RefreshSession.create({
        familyId: 'fam-300',
        userId: 'usr-logout-3',
        tenantId: 'tenant-alpha',
        clientId: 'e-commerce-spa',
      });
      await refreshSessionRepository.save(session);

      // When the client sends a POST request to "/oauth2/revoke"
      const res = await request(server)
        .post('/oauth2/revoke')
        .set('Cookie', [`refresh_token=${plainToken}`])
        .send();

      // Then the response status code should be 200 OK
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/revoked/i);

      // And the refresh_token cookie should be cleared with Max-Age 0
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie as string);
      expect(cookieStr).toMatch(/Max-Age=0/i);

      // And the session should be marked as revoked
      const familySessions = await refreshSessionRepository.findByFamilyId('fam-300');
      for (const s of familySessions) {
        expect(s.isRevoked()).toBe(true);
      }
    });
  });
});

