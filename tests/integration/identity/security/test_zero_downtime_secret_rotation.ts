import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import request from 'supertest';
import { Express } from 'express';
import { Pool } from 'pg';
import { createApp } from '../../../../interfaces/http/server';
import { DynamicPostgresPoolManager } from '../../../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';
import { SecretWatcherService } from '../../../../src/contexts/identity/infrastructure/security/secret_watcher_service';
import { InMemorySecurityAuditLogger } from '../../../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { JwksResponseDto } from '../../../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 25
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor condition timed out after ${timeoutMs}ms`);
};

describe('Integration E2E: Zero-Downtime Secret Rotation & CSI Driver Synchronization (US-16)', () => {
  let tempDir: string;
  let auditLogger: InMemorySecurityAuditLogger;

  const generateRsaKeyPair = () => {
    return crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  };

  const createMockPool = (identifier: string, isHealthy = true) => {
    const mockPool = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (!isHealthy) {
          throw new Error(`Database connection failed on pool [${identifier}]`);
        }
        if (sql.includes('SELECT 1')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      }),
      connect: jest.fn().mockImplementation(async () => {
        if (!isHealthy) {
          throw new Error(`Database connect failed on pool [${identifier}]`);
        }
        return {
          query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
          release: jest.fn(),
        };
      }),
      end: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as Pool;

    return mockPool;
  };

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'csi-secrets-e2e-'));
    auditLogger = new InMemorySecurityAuditLogger();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe('Scenario 1: In-Flight Database Credential Swap (Zero-Downtime)', () => {
    it('should dynamically swap database pools without dropping queries when database-url rotates', async () => {
      const initialDbUrl = 'postgresql://app_user:initial_secret_pass@pg-primary.internal:5432/identity_db';
      const rotatedDbUrl = 'postgresql://app_user:rotated_secret_pass@pg-replica.internal:5432/identity_db';

      // 1. Escribir secreto inicial en el directorio CSI
      await fs.promises.writeFile(path.join(tempDir, 'database-url'), initialDbUrl, 'utf8');

      // 2. Mock pool manager con poolFactory que rastrea pools instanciados
      const instantiatedPools: { [url: string]: Pool } = {};
      const poolFactory = (config: string | any): Pool => {
        const urlStr = typeof config === 'string' ? config : config.connectionString;
        const pool = createMockPool(urlStr, true);
        instantiatedPools[urlStr] = pool;
        return pool;
      };

      const initialPool = poolFactory(initialDbUrl);
      const poolManager = new DynamicPostgresPoolManager({
        initialPool,
        connectionString: initialDbUrl,
        poolFactory,
        drainGracePeriodMs: 50,
      });

      const secretWatcher = new SecretWatcherService({
        secretsDir: tempDir,
        debounceMs: 40,
        auditLogger,
      });

      const app: Express = createApp({
        poolManager,
        secretWatcher,
        auditLogger,
        secretsMountPath: tempDir,
      });

      await secretWatcher.start();

      // 3. Verificar estado inicial saludable a través del probe HTTP
      const initialHealth = await request(app).get('/health/ready');
      expect(initialHealth.status).toBe(200);
      expect(initialHealth.body.checks.database).toBe('OK');
      expect(poolManager.getGeneration()).toBe(1);

      // 4. Simular rotación de credenciales por el agente CSI en Kubernetes
      await fs.promises.writeFile(path.join(tempDir, 'database-url'), rotatedDbUrl, 'utf8');

      // 5. Esperar a que el SecretWatcher procese el debounce y aplique el swap
      await waitFor(() => poolManager.getGeneration() === 2);

      // 6. Verificar que /health/ready continúa respondiendo 200 OK con el nuevo pool activo (Zero-Downtime)
      const rotatedHealth = await request(app).get('/health/ready');
      expect(rotatedHealth.status).toBe(200);
      expect(rotatedHealth.body.checks.database).toBe('OK');
      expect(poolManager.getGeneration()).toBe(2);

      // 7. Verificar que se emitió el evento de auditoría 'secret_rotation_success'
      const auditSuccess = auditLogger.getEvents().find(
        (e) => e.eventType === 'secret_rotation_success' && (e.metadata as any)?.filename === 'database-url'
      );
      expect(auditSuccess).toBeDefined();

      secretWatcher.stop();
      await poolManager.close();
    });

    it('should fail-safe: preserve active pool and keep /health/ready UP when candidate credentials fail pre-swap check', async () => {
      const initialDbUrl = 'postgresql://app_user:valid_secret@pg-primary.internal:5432/identity_db';
      const corruptDbUrl = 'postgresql://app_user:corrupt_secret@pg-unreachable.internal:5432/identity_db';

      await fs.promises.writeFile(path.join(tempDir, 'database-url'), initialDbUrl, 'utf8');

      const poolFactory = (config: string | any): Pool => {
        const urlStr = typeof config === 'string' ? config : config.connectionString;
        const isHealthy = !urlStr.includes('corrupt');
        return createMockPool(urlStr, isHealthy);
      };

      const initialPool = poolFactory(initialDbUrl);
      const poolManager = new DynamicPostgresPoolManager({
        initialPool,
        connectionString: initialDbUrl,
        poolFactory,
        healthTimeoutMs: 100,
        drainGracePeriodMs: 50,
      });

      const secretWatcher = new SecretWatcherService({
        secretsDir: tempDir,
        debounceMs: 40,
        auditLogger,
      });

      const app: Express = createApp({
        poolManager,
        secretWatcher,
        auditLogger,
        secretsMountPath: tempDir,
      });

      await secretWatcher.start();

      expect(poolManager.getGeneration()).toBe(1);

      // Escribir credenciales corruptas
      await fs.promises.writeFile(path.join(tempDir, 'database-url'), corruptDbUrl, 'utf8');

      // Esperar a que el watcher intente la rotación y registre el fallo de auditoría
      await waitFor(() =>
        auditLogger.getEvents().some((e) => e.eventType === 'secret_rotation_failure')
      );

      // El pool activo debe mantenerse en la generación 1 sin interrumpir el servicio
      expect(poolManager.getGeneration()).toBe(1);

      const healthRes = await request(app).get('/health/ready');
      expect(healthRes.status).toBe(200);
      expect(healthRes.body.checks.database).toBe('OK');

      const failureEvent = auditLogger.getEvents().find(
        (e) => e.eventType === 'secret_rotation_failure' && (e.metadata as any)?.filename === 'database-url'
      );
      expect(failureEvent).toBeDefined();

      secretWatcher.stop();
      await poolManager.close();
    });
  });

  describe('Scenario 2: Hot Asymmetric Key Rollover via CSI Volume Mount', () => {
    it('should seamlessly verify tokens in flight during key rollover and expose both keys in JWKS', async () => {
      const keyPairV1 = generateRsaKeyPair();
      const keyPairV2 = generateRsaKeyPair();

      // 1. Montar clave V1 en el directorio CSI
      await fs.promises.writeFile(path.join(tempDir, 'jwt-private-key'), keyPairV1.privateKey, 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'jwt-public-key'), keyPairV1.publicKey, 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'jwt-key-id'), 'key-v1-csi', 'utf8');

      const secretWatcher = new SecretWatcherService({
        secretsDir: tempDir,
        debounceMs: 40,
        auditLogger,
      });

      const app: Express = createApp({
        secretWatcher,
        auditLogger,
        secretsMountPath: tempDir,
      });

      await secretWatcher.start();

      const asymmetricKeyProvider = app.locals.asymmetricKeyProvider;
      expect(asymmetricKeyProvider.getActiveKeyId()).toBe('key-v1-csi');

      // 2. Firmar un token con la clave V1 (simula token de sesión de usuario en vuelo)
      const tokenV1 = await asymmetricKeyProvider.signToken({
        sub: 'user-flight-session-123',
        tenantId: 'tenant-banking-77',
        scope: 'payments:transfer',
      });

      // Verificar que JWKS expone la clave inicial V1
      const jwksV1Res = await request(app).get('/.well-known/jwks.json');
      expect(jwksV1Res.status).toBe(200);
      const jwksV1Body = jwksV1Res.body as JwksResponseDto;
      expect(jwksV1Body.keys.length).toBe(1);
      expect(jwksV1Body.keys[0]?.kid).toBe('key-v1-csi');

      // 3. Simular Key Rollover en Kubernetes actualizando los archivos en el volumen CSI
      await fs.promises.writeFile(path.join(tempDir, 'jwt-private-key'), keyPairV2.privateKey, 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'jwt-public-key'), keyPairV2.publicKey, 'utf8');
      await fs.promises.writeFile(path.join(tempDir, 'jwt-key-id'), 'key-v2-csi', 'utf8');

      // 4. Esperar a que el SecretWatcher detecte el cambio y actualice la clave activa
      await waitFor(() => asymmetricKeyProvider.getActiveKeyId() === 'key-v2-csi');

      // 5. Firmar un nuevo token con la clave activa V2
      const tokenV2 = await asymmetricKeyProvider.signToken({
        sub: 'user-new-session-456',
        tenantId: 'tenant-banking-77',
      });

      // 6. Verificar que JWKS expone AMBAS claves (V2 activa y V1 retenida en ventana de gracia)
      const jwksV2Res = await request(app).get('/.well-known/jwks.json');
      expect(jwksV2Res.status).toBe(200);
      const jwksV2Body = jwksV2Res.body as JwksResponseDto;
      expect(jwksV2Body.keys.length).toBe(2);

      const publishedKids = jwksV2Body.keys.map((k) => k.kid);
      expect(publishedKids).toContain('key-v2-csi');
      expect(publishedKids).toContain('key-v1-csi');
      expect(jwksV2Body.keys[0]?.kid).toBe('key-v2-csi');

      // 7. Verificar que el token en vuelo emitido con V1 sigue siendo validado exitosamente (Zero-Downtime)
      const verifiedV1 = await asymmetricKeyProvider.verifyToken(tokenV1);
      expect(verifiedV1.sub).toBe('user-flight-session-123');
      expect(verifiedV1.scope).toBe('payments:transfer');

      // 8. Verificar que el token emitido con V2 se valida correctamente
      const verifiedV2 = await asymmetricKeyProvider.verifyToken(tokenV2);
      expect(verifiedV2.sub).toBe('user-new-session-456');

      secretWatcher.stop();
    });
  });

  describe('Scenario 3: Kubernetes Symlink Swap Synchronization (..data)', () => {
    it('should detect atomic symlink directory swap and update all mounted secrets in a single pass', async () => {
      // Simulación de la estructura interna del CSI Secret Store Driver en Kubernetes:
      // volume/
      //   ..2026_11_13_01/
      //     database-url
      //   ..data -> ..2026_11_13_01
      //   database-url -> ..data/database-url
      const dirV1 = path.join(tempDir, '..2026_11_13_01');
      const dirV2 = path.join(tempDir, '..2026_11_13_02');
      const symlinkData = path.join(tempDir, '..data');

      await fs.promises.mkdir(dirV1, { recursive: true });
      await fs.promises.mkdir(dirV2, { recursive: true });

      const urlV1 = 'postgresql://csi:pass1@pg-cluster.internal:5432/db';
      const urlV2 = 'postgresql://csi:pass2@pg-cluster.internal:5432/db';

      await fs.promises.writeFile(path.join(dirV1, 'database-url'), urlV1, 'utf8');
      await fs.promises.writeFile(path.join(dirV2, 'database-url'), urlV2, 'utf8');

      // Crear symlink ..data inicial
      await fs.promises.symlink(dirV1, symlinkData);
      // Crear symlink database-url apuntando a ..data/database-url
      await fs.promises.symlink(path.join(symlinkData, 'database-url'), path.join(tempDir, 'database-url'));

      let currentPoolUrl = '';
      const poolFactory = (config: string | any): Pool => {
        const urlStr = typeof config === 'string' ? config : config.connectionString;
        currentPoolUrl = urlStr;
        return createMockPool(urlStr, true);
      };

      const initialPool = poolFactory(urlV1);
      const poolManager = new DynamicPostgresPoolManager({
        initialPool,
        connectionString: urlV1,
        poolFactory,
        drainGracePeriodMs: 50,
      });

      const secretWatcher = new SecretWatcherService({
        secretsDir: tempDir,
        debounceMs: 50,
        auditLogger,
      });

      const app = createApp({
        poolManager,
        secretWatcher,
        auditLogger,
        secretsMountPath: tempDir,
      });

      await secretWatcher.start();

      expect(currentPoolUrl).toBe(urlV1);
      expect(poolManager.getGeneration()).toBe(1);

      // Simular swap atómico de Kubernetes:
      // 1. Crear symlink temporal ..data_tmp -> dirV2
      const symlinkDataTmp = path.join(tempDir, '..data_tmp');
      await fs.promises.symlink(dirV2, symlinkDataTmp);
      // 2. Renombrar atómicamente ..data_tmp a ..data
      await fs.promises.rename(symlinkDataTmp, symlinkData);

      // 3. Esperar que el watcher capture el evento del symlink '..data' y recargue las credenciales
      await waitFor(() => poolManager.getGeneration() === 2);

      expect(currentPoolUrl).toBe(urlV2);

      const healthRes = await request(app).get('/health/ready');
      expect(healthRes.status).toBe(200);

      secretWatcher.stop();
      await poolManager.close();
    });
  });
});
