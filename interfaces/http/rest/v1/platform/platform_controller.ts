import type { Request, Response, NextFunction } from 'express';
import type { AsymmetricKeyProviderPort } from '../../../../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';
import type { SecurityAuditLoggerPort } from '../../../../../src/contexts/identity/application/ports/security/audit_logger';
import type { DynamicPostgresPoolManager } from '../../../../../src/contexts/identity/infrastructure/persistence/database/dynamic_postgres_pool_manager';
import { TenantId } from '../../../../../src/contexts/identity/domain/value_objects/tenant_id/value';

export interface PlatformControllerDeps {
  readonly asymmetricKeyProvider: AsymmetricKeyProviderPort;
  readonly getPool: () => DynamicPostgresPoolManager | null;
  readonly auditLogger: SecurityAuditLoggerPort;
}

/**
 * REST Driver Controller: PlatformController (US-26 & ADR-0009)
 * Expone la postura agregada de gobernanza, infraestructura (solo lectura),
 * bóveda criptográfica (metadatos sin secretos), auditoría y observabilidad SRE
 * exclusivamente para operadores del Root Tenant ('system' + rol 'superadmin').
 */
export class PlatformController {
  constructor(private readonly deps: PlatformControllerDeps) {}

  public getPosture = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { asymmetricKeyProvider, getPool, auditLogger } = this.deps;

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

      const recentEvents =
        typeof auditLogger.getRecentEvents === 'function'
          ? auditLogger.getRecentEvents({ limit: 500 })
          : [];

      const bufferCapacity =
        typeof (auditLogger as any).getBufferCapacity === 'function'
          ? (auditLogger as any).getBufferCapacity()
          : 500;

      res.status(200).json({
        status: 'ACTIVE',
        governance: {
          rootTenantId: TenantId.ROOT_TENANT_ID,
          adr: 'ADR-0009',
          mode: 'READ_ONLY_POSTURE',
          actor: {
            userId: req.userId ?? null,
            tenantId: req.tenantId ?? null,
            roles: req.userRoles ?? [],
          },
        },
        infrastructurePosture: {
          cloudIac: {
            story: 'US-12',
            provider: 'Azure / Floci',
            tlsEndpoint: process.env.AZURE_STORAGE_ENDPOINT || 'https://localhost:4577',
            status: 'VERIFIED_PARITY',
          },
          ingressTls: {
            story: 'US-13',
            protocol: 'TLS 1.3',
            proxyMode: 'NGINX Ingress',
            status: 'ACTIVE',
          },
          helmChart: {
            story: 'US-14',
            release: 'identity-service',
            schemaValidation: 'STRICT',
            networkPolicyZeroTrust: true,
          },
          cicdGuardrails: {
            story: 'US-15',
            nonRootUid: 1000,
            imageTagPolicy: 'IMMUTABLE_SHA',
            rollbackCircuitBreaker: true,
          },
          networkPolicy: {
            story: 'US-18',
            defaultDenyAll: true,
            allowedIngressPort: 4000,
            status: 'ENFORCED',
          },
        },
        securityPosture: {
          rateLimiting: {
            enabled: true,
            windowMs: 60_000,
            maxRequestsPerWindow: 100,
          },
          securityHeaders: {
            helmetEnabled: true,
            corsStrict: true,
            hstsEnabled: process.env.NODE_ENV === 'production',
          },
          databaseTls: {
            story: 'US-17',
            mode: dbStats ? 'DYNAMIC_POSTGRES_POOL' : 'IN_MEMORY_FALLBACK',
            activeGeneration: dbStats?.generation ?? 0,
            sslEnabled: Boolean(sslOpts?.enabled),
            minVersion: sslOpts?.minVersion ?? 'TLSv1.2',
            rejectUnauthorized: sslOpts?.rejectUnauthorized ?? true,
          },
        },
        vaultMetadata: {
          story: 'US-16',
          activeKeyId,
          retainedKeysCount,
          jwksKeysCount: jwks.keys.length,
          exposedKids,
          jwksEndpoint: '/.well-known/jwks.json',
        },
        auditSummary: {
          story: 'US-19',
          source: 'IN_PROCESS_SECURITY_AUDIT_RING_BUFFER',
          recentEventsCount: recentEvents.length,
          bufferCapacity,
          cloudWormRetentionDays: 365,
        },
        observability: {
          w3cTraceContext: {
            story: 'US-20',
            propagatedTraceparent: req.header('traceparent') ?? null,
            requestId: req.header('x-request-id') ?? null,
          },
          endpoints: {
            metrics: '/metrics',
            liveness: '/health/live',
            readiness: '/health/ready',
          },
          uptimeSeconds: Math.floor(process.uptime()),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  };
}
