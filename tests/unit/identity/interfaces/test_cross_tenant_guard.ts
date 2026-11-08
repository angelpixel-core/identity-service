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
});
