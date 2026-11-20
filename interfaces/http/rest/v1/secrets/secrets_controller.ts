import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AsymmetricKeyProviderPort } from '../../../../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';
import type { SecurityAuditLoggerPort } from '../../../../../src/contexts/identity/application/ports/security/audit_logger';
import type { DynamicPostgresPoolManager } from '../../../../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';
import { SecurityConfigurationError } from '../../../../../src/contexts/identity/infrastructure/persistence/database/postgres_ssl_config';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

export interface SecretsControllerDeps {
  readonly asymmetricKeyProvider: AsymmetricKeyProviderPort;
  readonly getPool: () => DynamicPostgresPoolManager | null;
  readonly getDefaultDatabaseUrl: () => string | undefined;
  readonly auditLogger?: SecurityAuditLoggerPort;
}

/**
 * REST Driver Controller: SecretsController (US-16 & ADR-0009)
 * Expone operaciones reales de inspección y rotación en caliente sin downtime
 * sobre RsaKeyAdapter y DynamicPostgresPoolManager, protegidas por Root Tenant ('system').
 */
export class SecretsController {
  constructor(private readonly deps: SecretsControllerDeps) {}

  public getStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { asymmetricKeyProvider, getPool } = this.deps;
      const jwks = asymmetricKeyProvider.getPublicKeyJwks();
      const exposedKids = jwks.keys.map((k) => k.kid);
      const activeKeyId = asymmetricKeyProvider.getActiveKeyId();
      const retainedKeysCount =
        typeof (asymmetricKeyProvider as any).getRetainedKeysCount === 'function'
          ? (asymmetricKeyProvider as any).getRetainedKeysCount()
          : Math.max(0, jwks.keys.length - 1);

      const poolManager = getPool();
      const dbStats = poolManager ? poolManager.getStats() : null;
      const sslOpts =
        poolManager && typeof poolManager.getSslOptions === 'function'
          ? poolManager.getSslOptions()
          : undefined;

      res.status(200).json({
        status: 'ACTIVE',
        signingKeys: {
          activeKeyId,
          retainedKeysCount,
          jwksKeysCount: jwks.keys.length,
          exposedKids,
          jwksEndpoint: '/.well-known/jwks.json',
        },
        databasePool: dbStats
          ? {
              mode: 'DYNAMIC_POSTGRES_POOL',
              activeGeneration: dbStats.generation,
              retiringPoolsCount: dbStats.retiringPoolsCount,
              totalConnections: dbStats.activePoolTotalCount ?? 0,
              idleConnections: dbStats.activePoolIdleCount ?? 0,
              waitingClients: dbStats.activePoolWaitingCount ?? 0,
              ssl: {
                enabled: Boolean(sslOpts?.enabled),
                minVersion: sslOpts?.minVersion ?? 'TLSv1.2',
                rejectUnauthorized: sslOpts?.rejectUnauthorized ?? true,
                caConfigured: Boolean(
                  sslOpts?.ca ||
                    sslOpts?.caPath ||
                    process.env.DATABASE_SSL_CA ||
                    process.env.DATABASE_SSL_CA_PATH
                ),
              },
            }
          : {
              mode: 'IN_MEMORY_FALLBACK',
              activeGeneration: 0,
              retiringPoolsCount: 0,
            },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };

  public rotateSigningKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { asymmetricKeyProvider, auditLogger } = this.deps;

      if (typeof asymmetricKeyProvider.rotateKeyPair !== 'function') {
        res.status(501).json({
          error: 'Active asymmetric key provider does not support hot key rollover',
        });
        return;
      }

      const previousKeyId = asymmetricKeyProvider.getActiveKeyId();
      const requestedKeyId =
        typeof req.body?.keyId === 'string' && req.body.keyId.trim().length > 0
          ? req.body.keyId.trim()
          : `kid_rsa_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const gracePeriodMs =
        typeof req.body?.gracePeriodMs === 'number' && req.body.gracePeriodMs > 0
          ? req.body.gracePeriodMs
          : 15 * 60 * 1000;

      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      asymmetricKeyProvider.rotateKeyPair({
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
        keyId: requestedKeyId,
        gracePeriodMs,
      });

      const activeKeyId = asymmetricKeyProvider.getActiveKeyId();
      const jwks = asymmetricKeyProvider.getPublicKeyJwks();
      const exposedKids = jwks.keys.map((k) => k.kid);
      const retainedKeysCount =
        typeof (asymmetricKeyProvider as any).getRetainedKeysCount === 'function'
          ? (asymmetricKeyProvider as any).getRetainedKeysCount()
          : Math.max(0, jwks.keys.length - 1);

      if (auditLogger) {
        await auditLogger.logEvent({
          eventType: 'SECRET_ROTATION_SUCCESS',
          severity: 'INFO',
          status: 'SUCCESS',
          timestamp: new Date(),
          tenantId: TenantId.ROOT_TENANT_ID,
          actor: {
            userId: req.userId,
            type: 'OPERATOR',
            ip: req.ip,
          },
          trace: {
            requestId:
              (req.headers && (req.headers['x-request-id'] as string)) ||
              (req as any).id,
            correlationId:
              req.headers && (req.headers['x-correlation-id'] as string),
          },
          compliance: {
            pciRequirement: '10.2.6',
            soc2Criteria: 'CC6.1',
            retentionCategory: 'AUDIT_IMMUTABLE',
          },
          action: 'rsa_signing_key_rotated',
          ip: req.ip,
          metadata: {
            secretType: 'rsa_signing_keypair',
            previousKeyId,
            activeKeyId,
            jwksKeysCount: jwks.keys.length,
            gracePeriodMs,
          },
        });
      }

      res.status(200).json({
        status: 'SUCCESS',
        operation: 'HOT_ASYMMETRIC_KEY_ROLLOVER',
        previousKeyId,
        activeKeyId,
        retainedKeysCount,
        jwksKeysCount: jwks.keys.length,
        exposedKids,
        jwksEndpoint: '/.well-known/jwks.json',
        gracePeriodMs,
        compliance: {
          pciRequirement: '10.2.6',
          soc2Criteria: 'CC6.1',
          auditEventEmitted: 'SECRET_ROTATION_SUCCESS',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };

  public rotateDbCredentials = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { getPool, getDefaultDatabaseUrl, auditLogger } = this.deps;
      const poolManager = getPool();

      if (!poolManager) {
        res.status(503).json({
          error: 'Dynamic PostgreSQL pool manager is not active in this runtime mode',
        });
        return;
      }

      const candidateUrl =
        typeof req.body?.databaseUrl === 'string' && req.body.databaseUrl.trim().length > 0
          ? req.body.databaseUrl.trim()
          : getDefaultDatabaseUrl();

      if (!candidateUrl) {
        res.status(400).json({
          error: 'No candidate databaseUrl provided and no active DATABASE_URL configured',
        });
        return;
      }

      const previousGeneration = poolManager.getGeneration();

      try {
        await poolManager.reloadCredentials(candidateUrl);
        const stats = poolManager.getStats();

        if (auditLogger) {
          await auditLogger.logEvent({
            eventType: 'SECRET_ROTATION_SUCCESS',
            severity: 'INFO',
            status: 'SUCCESS',
            timestamp: new Date(),
            tenantId: TenantId.ROOT_TENANT_ID,
            actor: {
              userId: req.userId,
              type: 'OPERATOR',
              ip: req.ip,
            },
            trace: {
              requestId:
                (req.headers && (req.headers['x-request-id'] as string)) ||
                (req as any).id,
              correlationId:
                req.headers && (req.headers['x-correlation-id'] as string),
            },
            compliance: {
              pciRequirement: '10.2.6',
              soc2Criteria: 'CC6.1',
              retentionCategory: 'AUDIT_IMMUTABLE',
            },
            action: 'database_credentials_rotated',
            ip: req.ip,
            metadata: {
              secretType: 'database_credentials',
              previousGeneration,
              activeGeneration: stats.generation,
              retiringPoolsCount: stats.retiringPoolsCount,
            },
          });
        }

        res.status(200).json({
          status: 'SUCCESS',
          operation: 'ZERO_DOWNTIME_DB_POOL_SWAP',
          previousGeneration,
          activeGeneration: stats.generation,
          retiringPoolsCount: stats.retiringPoolsCount,
          swapType: 'ATOMIC_POINTER_SWAP',
          compliance: {
            pciRequirement: '10.2.6',
            soc2Criteria: 'CC6.1',
            auditEventEmitted: 'SECRET_ROTATION_SUCCESS',
          },
          timestamp: new Date().toISOString(),
        });
      } catch (rotationErr: unknown) {
        const errMsg = rotationErr instanceof Error ? rotationErr.message : String(rotationErr);
        const stats = poolManager.getStats();
        const isSslDowngrade = rotationErr instanceof SecurityConfigurationError;

        if (auditLogger) {
          await auditLogger.logEvent({
            eventType: 'SECRET_ROTATION_FAILURE',
            severity: isSslDowngrade ? 'CRITICAL' : 'ALERT',
            status: 'FAILURE',
            timestamp: new Date(),
            tenantId: TenantId.ROOT_TENANT_ID,
            actor: {
              userId: req.userId,
              type: 'OPERATOR',
              ip: req.ip,
            },
            trace: {
              requestId:
                (req.headers && (req.headers['x-request-id'] as string)) ||
                (req as any).id,
              correlationId:
                req.headers && (req.headers['x-correlation-id'] as string),
            },
            compliance: {
              pciRequirement: isSslDowngrade ? '4.1' : '10.2.6',
              soc2Criteria: isSslDowngrade ? 'CC6.7' : 'CC6.1',
              retentionCategory: 'AUDIT_IMMUTABLE',
            },
            action: isSslDowngrade
              ? 'database_ssl_downgrade_blocked'
              : 'database_credentials_rotation_aborted',
            ip: req.ip,
            reason: isSslDowngrade ? 'SSL_DOWNGRADE_BLOCKED' : 'PREFLIGHT_HEALTHCHECK_FAILED',
            metadata: {
              secretType: 'database_credentials',
              activeGeneration: stats.generation,
              failSafePreserved: true,
              error: errMsg,
            },
          });
        }

        res.status(422).json({
          status: isSslDowngrade ? 'BLOCKED_ANTI_DOWNGRADE' : 'FAILED_SAFE',
          operation: 'ZERO_DOWNTIME_DB_POOL_SWAP',
          failSafePreserved: true,
          activeGeneration: stats.generation,
          reason: isSslDowngrade ? 'SSL_DOWNGRADE_BLOCKED' : 'PREFLIGHT_HEALTHCHECK_FAILED',
          error: isSslDowngrade
            ? `Anti-Downgrade SSL Guard blocked insecure candidate; active pool Generation ${stats.generation} preserved without downtime: ${errMsg}`
            : `Pre-flight check failed; active pool Generation ${stats.generation} preserved without downtime: ${errMsg}`,
          compliance: {
            pciRequirement: isSslDowngrade ? '4.1' : '10.2.6',
            soc2Criteria: isSslDowngrade ? 'CC6.7' : 'CC6.1',
            auditEventEmitted: 'SECRET_ROTATION_FAILURE',
          },
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      next(error);
    }
  };
}
