import { Request, Response, NextFunction } from 'express';
import { createCrossTenantGuard } from '../../../../interfaces/http/middlewares/security_audit_logger';
import { SecurityAuditLoggerPort } from '../../../../src/contexts/identity/application/ports/security/audit_logger';

describe('HTTP Interface Middleware: createCrossTenantGuard', () => {
  let auditLogger: jest.Mocked<SecurityAuditLoggerPort>;
  let guard: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  beforeEach(() => {
    auditLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };
    guard = createCrossTenantGuard(auditLogger);
  });

  const createMockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
  };

  it('should call next() if req.tenantId is not defined', async () => {
    const req = {
      params: {},
      body: { tenantId: 'tenant-beta' },
      query: {},
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(auditLogger.logEvent).not.toHaveBeenCalled();
  });

  it('should call next() when requested body tenantId matches active authenticated tenantId', async () => {
    const req = {
      tenantId: 'tenant-alpha',
      body: { tenantId: 'tenant-alpha' },
      params: {},
      query: {},
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(auditLogger.logEvent).not.toHaveBeenCalled();
  });

  it('should call next() when no tenantId is supplied in body, params, or query', async () => {
    const req = {
      tenantId: 'tenant-alpha',
      body: { email: 'alice@alpha.com' },
      params: { userId: 'user-1' },
      query: {},
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should block with 403 Forbidden and log security audit event when body tenantId differs', async () => {
    const req = {
      tenantId: 'tenant-alpha',
      body: { tenantId: 'tenant-evil' },
      params: {},
      query: {},
      ip: '192.168.1.50',
      userId: 'user-malicious',
      originalUrl: '/api/v1/users/user-1',
      method: 'PATCH',
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden: Cross-tenant access violation detected',
    });
    expect(auditLogger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'cross_tenant_violation',
        reason: 'CROSS_TENANT_VIOLATION',
        ip: '192.168.1.50',
        metadata: {
          activeTenantId: 'tenant-alpha',
          attemptedTenantId: 'tenant-evil',
          userId: 'user-malicious',
          path: '/api/v1/users/user-1',
          method: 'PATCH',
        },
      })
    );
  });

  it('should block with 403 Forbidden and log event when params tenantId differs', async () => {
    const req = {
      tenantId: 'tenant-alpha',
      params: { tenantId: 'tenant-attacker' },
      body: {},
      query: {},
      ip: '10.0.0.1',
      originalUrl: '/api/v1/tenants/tenant-attacker/resource',
      method: 'GET',
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(auditLogger.logEvent).toHaveBeenCalledTimes(1);
  });

  it('should block with 403 Forbidden and log event when query tenantId differs', async () => {
    const req = {
      tenantId: 'tenant-alpha',
      query: { tenantId: 'tenant-other' },
      params: {},
      body: {},
      ip: '10.0.0.2',
      originalUrl: '/api/v1/users?tenantId=tenant-other',
      method: 'GET',
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guard(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(auditLogger.logEvent).toHaveBeenCalledTimes(1);
  });

  it('should block with 403 Forbidden even without audit logger provided', async () => {
    const guardWithoutLogger = createCrossTenantGuard();
    const req = {
      tenantId: 'tenant-alpha',
      body: { tenantId: 'tenant-beta' },
      params: {},
      query: {},
    } as unknown as Request;
    const res = createMockRes();
    const next = jest.fn();

    await guardWithoutLogger(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  describe('Root Tenant & Platform Operator Delegation (ADR-0009 & Zero-Trust)', () => {
    it('should grant cross-tenant access to Root Superadmin and log platform_operator_cross_tenant_action', async () => {
      const req = {
        tenantId: 'system',
        userId: 'admin-root-001',
        userRoles: ['superadmin'],
        body: { tenantId: 'tenant-target-corp' },
        params: {},
        query: {},
        ip: '10.0.0.100',
        originalUrl: '/api/v1/users',
        method: 'POST',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await guard(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'platform_operator_cross_tenant_action',
          severity: 'WARN',
          status: 'GRANTED_ELEVATED',
          tenantId: 'tenant-target-corp',
          reason: 'PLATFORM_OPERATOR_CROSS_TENANT_ACTION',
          metadata: expect.objectContaining({
            operatorTenantId: 'system',
            targetTenantId: 'tenant-target-corp',
            userId: 'admin-root-001',
          }),
        })
      );
    });

    it('should grant cross-tenant access when req.isRootAdmin is true and roles include superadmin', async () => {
      const req = {
        tenantId: 'tenant-delegated',
        isRootAdmin: true,
        userRoles: ['superadmin'],
        body: { tenantId: 'tenant-other' },
        params: {},
        query: {},
        ip: '10.0.0.101',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await guard(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'platform_operator_cross_tenant_action',
          status: 'GRANTED_ELEVATED',
        })
      );
    });

    it('should BLOCK commercial tenant user who has superadmin role when accessing another tenant (Zero-Trust Invariant)', async () => {
      const req = {
        tenantId: 'tenant-commercial',
        userId: 'commercial-admin-001',
        userRoles: ['superadmin'], // Role superadmin in commercial tenant MUST NOT bypass isolation
        body: { tenantId: 'tenant-victim' },
        params: {},
        query: {},
        ip: '192.168.1.10',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await guard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_violation',
          severity: 'ALERT',
          status: 'DENIED',
          metadata: expect.objectContaining({
            activeTenantId: 'tenant-commercial',
            attemptedTenantId: 'tenant-victim',
          }),
        })
      );
    });

    it('should BLOCK system tenant user WITHOUT superadmin role from cross-tenant access', async () => {
      const req = {
        tenantId: 'system',
        userId: 'system-regular-user',
        userRoles: ['member'],
        body: { tenantId: 'tenant-beta' },
        params: {},
        query: {},
        ip: '10.0.0.105',
      } as unknown as Request;
      const res = createMockRes();
      const next = jest.fn();

      await guard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cross_tenant_violation',
          severity: 'ALERT',
          status: 'DENIED',
        })
      );
    });
  });
});
