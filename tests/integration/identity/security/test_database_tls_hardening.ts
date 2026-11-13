import request from 'supertest';
import { Express } from 'express';
import { Pool } from 'pg';
import { createApp } from '../../../../interfaces/http/server';
import {
  DynamicPostgresPoolManager,
  PostgresSslOptions,
} from '../../../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';
import { InMemorySecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';

describe('Integration E2E: Database Encryption In-Flight TLS & Hardening (US-17)', () => {
  const MOCK_AZURE_DIGICERT_CA = `-----BEGIN CERTIFICATE-----
MIIEtjCCA56gAwIBAgIQDH94iP6Xw/w7Q6aJk5u2rTANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBD
QTAeFw0xMzAzMDgxMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IENBMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4jvhEXLeqKTTo1eqUKKPC3eQyaKl7hLOFAsB
-----END CERTIFICATE-----`;

  const createMockTlsPool = (configCaptured: { current?: any }) => {
    const mockPool = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT 1')) {
          return { rows: [{ health_check: 1 }] };
        }
        return { rows: [] };
      }),
      connect: jest.fn().mockImplementation(async () => {
        return {
          query: jest.fn().mockResolvedValue({ rows: [{ health_check: 1 }] }),
          release: jest.fn(),
        };
      }),
      end: jest.fn().mockResolvedValue(undefined),
      totalCount: 5,
      idleCount: 3,
      waitingCount: 0,
    } as unknown as Pool;

    return (cfg: any) => {
      configCaptured.current = cfg;
      return mockPool;
    };
  };

  describe('Scenario 1: Full In-Flight TLS 1.2+ Enforcement with CA Certificate Validation', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should initialize dynamic pool with strict TLS 1.2+ and valid CA, serving /health probes with 200 OK', async () => {
      const capturedConfig: { current?: any } = {};
      const mockPoolFactory = createMockTlsPool(capturedConfig);

      const sslOptions: PostgresSslOptions = {
        enabled: true,
        minVersion: 'TLSv1.2',
        ca: MOCK_AZURE_DIGICERT_CA,
      };

      const customPoolManager = new DynamicPostgresPoolManager({
        connectionString: 'postgresql://app_admin:secret@pg-flexible-server.postgres.database.azure.com:5432/identity_prod',
        sslOptions,
        poolFactory: mockPoolFactory,
      });

      const auditLogger = new InMemorySecurityAuditLogger();

      const app: Express = createApp({
        poolManager: customPoolManager,
        auditLogger,
      });

      // 1. Verificar configuración de SSL/TLS aplicada en el pool
      expect(capturedConfig.current).toBeDefined();
      expect(capturedConfig.current.ssl).toBeDefined();
      expect(capturedConfig.current.ssl.rejectUnauthorized).toBe(true);
      expect(capturedConfig.current.ssl.minVersion).toBe('TLSv1.2');
      expect(capturedConfig.current.ssl.ca).toBe(MOCK_AZURE_DIGICERT_CA);

      // 2. Verificar que los probes de salud de Kubernetes responden 200 OK
      const readyRes = await request(app).get('/health/ready');
      expect(readyRes.status).toBe(200);
      expect(readyRes.body.status).toBe('UP');
      expect(readyRes.body.checks.database).toBe('OK');
      expect(readyRes.body.checks.cache).toBe('OK');

      const healthRes = await request(app).get('/health');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.status).toBe('UP');
      expect(healthRes.body.checks.database).toBe('OK');

      // 3. Verificar liveness probe
      const liveRes = await request(app).get('/health/live');
      expect(liveRes.status).toBe(200);
      expect(liveRes.body.status).toBe('UP');

      await customPoolManager.close();
    });

    it('should resolve SSL configuration from environment variables (DATABASE_SSL_*) on bootstrap', async () => {
      process.env.DATABASE_URL = 'postgresql://azure_user:azure_pass@pg-prod.postgres.database.azure.com:5432/identity_prod';
      process.env.DATABASE_SSL_ENABLED = 'true';
      process.env.DATABASE_SSL_MIN_VERSION = 'TLSv1.3';
      process.env.DATABASE_SSL_CA = MOCK_AZURE_DIGICERT_CA;

      const app: Express = createApp();

      const poolManager = app.locals.poolManager as DynamicPostgresPoolManager;
      expect(poolManager).toBeDefined();
      expect(poolManager.getGeneration()).toBe(1);

      const resolvedSsl = poolManager.getSslOptions();
      expect(resolvedSsl).toBeDefined();
      expect(resolvedSsl?.enabled).toBe(true);
      expect(resolvedSsl?.minVersion).toBe('TLSv1.3');
      expect(resolvedSsl?.ca).toBe(MOCK_AZURE_DIGICERT_CA);

      await poolManager.close();
    });
  });
});

