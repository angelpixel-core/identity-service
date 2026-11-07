import dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

import express, { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { RegisterUserCommandHandler } from '../../src/contexts/identity/application/commands/register_user/handler';
import { GetUserProfileQueryHandler } from '../../src/contexts/identity/application/queries/get_user_profile/handler';
import { ValidateClientOriginQueryHandler } from '../../src/contexts/identity/application/queries/validate_client_origin/handler';
import { AuthenticateClientM2MCommandHandler } from '../../src/contexts/identity/application/commands/authenticate_client_m2m/handler';
import { UserRepositoryPort } from '../../src/contexts/identity/application/ports/user/repository';
import { HashProviderPort } from '../../src/contexts/identity/application/ports/security/hash_provider';
import { TokenProviderPort } from '../../src/contexts/identity/application/ports/security/token_provider';
import { CacheProviderPort } from '../../src/contexts/identity/application/ports/cache/cache_provider';
import { BcryptAdapter } from '../../src/contexts/identity/infrastructure/security/bcrypt_adapter';
import { JwtTokenAdapter } from '../../src/contexts/identity/infrastructure/security/jwt_adapter';
import { InMemorySecurityAuditLogger } from '../../src/contexts/identity/infrastructure/logging/memory_security_audit_logger';
import { MemoryCacheAdapter } from '../../src/contexts/identity/infrastructure/cache/memory_cache_adapter';
import { PostgresUserRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/user/repository';
import { User } from '../../src/contexts/identity/domain/entities/user/aggregate';
import { Email } from '../../src/contexts/identity/domain/value_objects/email/value';
import { TenantId } from '../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { tenantContextMiddleware } from './middlewares/tenant_context_middleware';
import { createAuthMiddleware } from './middlewares/auth_middleware';
import { clientAuthorizationMiddleware } from './middlewares/client_authorization_middleware';
import { ClientApplicationRepositoryPort } from '../../src/contexts/identity/domain/ports/client_application_repository_port';
import { PostgresClientApplicationRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/client_application/postgres_client_repository';
import { InMemoryClientApplicationRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { AuthController } from './rest/v1/identity/controllers';
import { OAuth2ClientController } from './rest/v1/oauth2/client_controller';
import { OAuth2TokenController } from './rest/v1/oauth2/token_controller';

/**
 * Implementación en memoria del repositorio para testing e inicialización desacoplada.
 */
class InMemoryUserRepository implements UserRepositoryPort {
  private readonly users: Map<string, User> = new Map();

  public async save(user: User): Promise<void> {
    const key = `${user.getTenantId().getValue()}:${user.getId()}`;
    this.users.set(key, user);
  }

  public async findByEmail(email: Email, tenantId: TenantId): Promise<User | null> {
    for (const user of this.users.values()) {
      if (
        user.getTenantId().equals(tenantId) &&
        user.getEmail().equals(email)
      ) {
        return user;
      }
    }
    return null;
  }

  public async findById(id: string, tenantId: TenantId): Promise<User | null> {
    const key = `${tenantId.getValue()}:${id}`;
    return this.users.get(key) ?? null;
  }
}

export interface AppDependencies {
  userRepository?: UserRepositoryPort;
  clientRepository?: ClientApplicationRepositoryPort;
  hashProvider?: HashProviderPort;
  tokenProvider?: TokenProviderPort;
  cacheProvider?: CacheProviderPort;
}

/**
 * Factoría de la aplicación Express (Driver Adapter HTTP).
 * Permite inyección de dependencias para tests y entornos productivos.
 */
export function createApp(deps?: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  let userRepository = deps?.userRepository;
  if (!userRepository) {
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      userRepository = new PostgresUserRepository(pool);
    } else {
      userRepository = new InMemoryUserRepository();
    }
  }

  let clientRepository = deps?.clientRepository;
  if (!clientRepository) {
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      clientRepository = new PostgresClientApplicationRepository(pool);
    } else {
      clientRepository = new InMemoryClientApplicationRepository(true);
    }
  }

  const hashProvider = deps?.hashProvider ?? new BcryptAdapter(6); // Rondas optimizadas para HTTP
  const jwtSecret = process.env.JWT_SECRET || 'default-jwt-secret-key-12345';
  const tokenProvider = deps?.tokenProvider ?? new JwtTokenAdapter(jwtSecret, '1h');
  const cacheProvider = deps?.cacheProvider ?? new MemoryCacheAdapter();
  const cacheTtlSeconds = Number(process.env.CACHE_TTL_SECONDS) || 300;

  const registerUserHandler = new RegisterUserCommandHandler(
    userRepository,
    hashProvider,
    tokenProvider
  );

  const getProfileHandler = new GetUserProfileQueryHandler(
    userRepository,
    cacheProvider,
    cacheTtlSeconds
  );

  const validateClientOriginHandler = new ValidateClientOriginQueryHandler(
    clientRepository,
    cacheProvider,
    cacheTtlSeconds
  );

  const auditLogger = new InMemorySecurityAuditLogger();

  const authenticateClientM2MHandler = new AuthenticateClientM2MCommandHandler(
    clientRepository,
    hashProvider,
    tokenProvider,
    auditLogger,
    3600
  );

  const authController = new AuthController(registerUserHandler, getProfileHandler);
  const oauth2ClientController = new OAuth2ClientController(validateClientOriginHandler);
  const oauth2TokenController = new OAuth2TokenController(authenticateClientM2MHandler);
  const authMiddleware = createAuthMiddleware(tokenProvider);

  // Rutas de Identidad y Autenticación v1
  app.post('/api/v1/auth/register', tenantContextMiddleware, authController.register);
  app.get('/api/v1/auth/me', tenantContextMiddleware, authMiddleware, authController.getProfile);

  // Rutas OAuth2 / Client Registry v1
  app.post(
    '/api/v1/oauth2/clients/validate',
    clientAuthorizationMiddleware(validateClientOriginHandler),
    oauth2ClientController.validateClientOrigin
  );

  // Rutas OAuth2 Token (RFC 6749)
  app.post('/api/v1/oauth2/token', oauth2TokenController.issueToken);
  app.post('/oauth2/token', oauth2TokenController.issueToken);

  // Manejador global de errores no capturados
  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}

export const app = createApp();

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Identity Service HTTP Server listening on port ${PORT}`);
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      console.log(`Connected to PostgreSQL: ${process.env.DATABASE_URL}`);
    } else {
      console.log('Running in isolated in-memory storage mode');
    }
  });
}
