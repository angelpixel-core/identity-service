import { Request, Response, NextFunction } from 'express';
import { createAuthMiddleware } from '../../../../interfaces/http/middlewares/auth_middleware';
import { TokenProviderPort, AuthTokenClaims } from '../../../../src/contexts/identity/application/ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../../../src/contexts/identity/application/ports/security/audit_logger';

describe('HTTP Interface Middleware: createAuthMiddleware', () => {
  let tokenProvider: jest.Mocked<TokenProviderPort>;
  let auditLogger: jest.Mocked<SecurityAuditLoggerPort>;
  let middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  const createMockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
  };

  beforeEach(() => {
    tokenProvider = {
      generateToken: jest.fn(),
      verifyToken: jest.fn(),
    };
    auditLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };
    middleware = createAuthMiddleware(tokenProvider, auditLogger);
  });

  describe('Authorization Header Validation', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const req = { headers: {} } as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing Authorization header' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when header format is invalid', async () => {
      const req = { headers: { authorization: 'Basic abc123xyz' } } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid Authorization header format. Expected "Bearer <token>"',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token is invalid or expired', async () => {
      tokenProvider.verifyToken.mockRejectedValue(new Error('Token expired'));

      const req = { headers: { authorization: 'Bearer expired-token' } } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Successful Authentication & Context Injection', () => {
    it('should attach userId, userRoles, and populate tenantId when matching', async () => {
      const claims: AuthTokenClaims = {
        userId: 'user-123',
        email: 'alice@alpha.com',
        tenantId: 'tenant-alpha',
        roles: ['member', 'editor'],
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: { authorization: 'Bearer valid-token' },
        tenantId: 'tenant-alpha',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.userId).toBe('user-123');
      expect(req.userRoles).toEqual(['member', 'editor']);
      expect(req.isRootAdmin).toBe(false);
      expect(req.tenantId).toBe('tenant-alpha');
    });

    it('should populate req.tenantId from claims if not already set on request', async () => {
      const claims: AuthTokenClaims = {
        userId: 'user-456',
        email: 'bob@beta.com',
        tenantId: 'tenant-beta',
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: { authorization: 'Bearer valid-token' },
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.tenantId).toBe('tenant-beta');
      expect(req.userRoles).toEqual([]);
      expect(req.isRootAdmin).toBe(false);
    });
  });

  describe('Multi-Tenant Isolation & Cross-Tenant Violation Checks', () => {
    it('should reject with 403 and log cross_tenant_violation when commercial tenant token does not match req.tenantId', async () => {
      const claims: AuthTokenClaims = {
        userId: 'attacker-1',
        email: 'attacker@evil.com',
        tenantId: 'tenant-evil',
        roles: ['member'],
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: { authorization: 'Bearer token-evil', 'x-request-id': 'req-99' },
        tenantId: 'tenant-victim',
        ip: '10.0.0.99',
        originalUrl: '/api/v1/users',
        method: 'GET',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Forbidden: Token does not belong to the requested tenant context',
      });
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_violation',
          severity: 'ALERT',
          status: 'DENIED',
          tenantId: 'tenant-evil',
          reason: 'CROSS_TENANT_VIOLATION',
        })
      );
    });

    it('should BLOCK commercial tenant user with superadmin role from cross-tenant access (Zero-Trust Invariant)', async () => {
      const claims: AuthTokenClaims = {
        userId: 'commercial-admin',
        email: 'admin@acme.com',
        tenantId: 'tenant-acme',
        roles: ['superadmin'], // Role superadmin outside of system tenant MUST be denied
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: { authorization: 'Bearer commercial-admin-token' },
        tenantId: 'tenant-target',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_violation',
          status: 'DENIED',
        })
      );
    });
  });

  describe('Root Tenant & Platform Operator Delegation (ADR-0009)', () => {
    it('should grant cross-tenant access to Root Superadmin and log platform_operator_cross_tenant_action', async () => {
      const claims: AuthTokenClaims = {
        userId: 'root-superadmin-001',
        email: 'admin@angelpixel.io',
        tenantId: 'system',
        roles: ['superadmin'],
        actorType: 'platform_operator',
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: {
          authorization: 'Bearer root-admin-jwt',
          'x-request-id': 'req-root-01',
          'x-correlation-id': 'corr-root-01',
        },
        tenantId: 'tenant-customer-abc', // Superadmin targeting a customer tenant
        ip: '127.0.0.1',
        originalUrl: '/api/v1/users',
        method: 'GET',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(req.userId).toBe('root-superadmin-001');
      expect(req.userRoles).toEqual(['superadmin']);
      expect(req.isRootAdmin).toBe(true);
      expect(req.tenantId).toBe('tenant-customer-abc');

      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'platform_operator_cross_tenant_action',
          severity: 'WARN',
          status: 'GRANTED_ELEVATED',
          tenantId: 'tenant-customer-abc',
          reason: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
          metadata: expect.objectContaining({
            operatorTenantId: 'system',
            targetTenantId: 'tenant-customer-abc',
            userId: 'root-superadmin-001',
          }),
        })
      );
    });

    it('should BLOCK system user who does not have superadmin role from cross-tenant access', async () => {
      const claims: AuthTokenClaims = {
        userId: 'system-staff-user',
        email: 'staff@angelpixel.io',
        tenantId: 'system',
        roles: ['member', 'support'], // Not superadmin
      };
      tokenProvider.verifyToken.mockResolvedValue(claims);

      const req = {
        headers: { authorization: 'Bearer system-staff-jwt' },
        tenantId: 'tenant-customer-xyz',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_violation',
          status: 'DENIED',
        })
      );
    });
  });
});
