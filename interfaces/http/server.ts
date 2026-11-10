import dotenv from 'dotenv';
if (process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

import fs from 'fs';
import path from 'path';
import express, { Express, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import yaml from 'yaml';
import { Pool } from 'pg';
import { RegisterUserCommandHandler } from '../../src/contexts/identity/application/commands/register_user/handler';
import { UpdateUserProfileCommandHandler } from '../../src/contexts/identity/application/commands/update_user_profile/handler';
import { GetUserProfileQueryHandler } from '../../src/contexts/identity/application/queries/get_user_profile/handler';
import { ValidateClientOriginQueryHandler } from '../../src/contexts/identity/application/queries/validate_client_origin/handler';
import { AuthenticateClientM2MCommandHandler } from '../../src/contexts/identity/application/commands/authenticate_client_m2m/handler';
import { UserRepositoryPort } from '../../src/contexts/identity/application/ports/user/repository';
import { HashProviderPort } from '../../src/contexts/identity/application/ports/security/hash_provider';
import { TokenProviderPort } from '../../src/contexts/identity/application/ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../src/contexts/identity/application/ports/security/audit_logger';
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
import { createCrossTenantGuard } from './middlewares/security_audit_logger';
import { clientAuthorizationMiddleware } from './middlewares/client_authorization_middleware';
import { ClientApplicationRepositoryPort } from '../../src/contexts/identity/domain/ports/client_application_repository_port';
import { PostgresClientApplicationRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/client_application/postgres_client_repository';
import { InMemoryClientApplicationRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { TenantTransactionRunnerPort } from '../../src/contexts/identity/application/ports/database/tenant_transaction_runner';
import { TenantAwareTransactionRunner } from '../../src/contexts/identity/infrastructure/persistence/database/tenant_aware_transaction_runner';
import { AuthController } from './rest/v1/identity/controllers';
import { UserController } from './rest/v1/identity/user_controller';
import { OAuth2ClientController } from './rest/v1/oauth2/client_controller';
import { OAuth2TokenController } from './rest/v1/oauth2/token_controller';
import { OAuth2AuthorizeController } from './rest/v1/oauth2/authorize_controller';
import { AuthorizationCodeRepositoryPort } from '../../src/contexts/identity/domain/ports/authorization_code_repository_port';
import { InMemoryAuthorizationCodeRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/authorization_code/in_memory_repository';
import { IssueAuthorizationCodeCommandHandler } from '../../src/contexts/identity/application/commands/issue_authorization_code/handler';
import { ExchangeAuthorizationCodeCommandHandler } from '../../src/contexts/identity/application/commands/exchange_authorization_code/handler';
import { AsymmetricKeyProviderPort } from '../../src/contexts/identity/domain/ports/crypto/asymmetric_key_provider_port';
import { RsaKeyAdapter } from '../../src/contexts/identity/infrastructure/security/rsa_key_adapter';
import { GetOpenIdConfigurationQueryHandler } from '../../src/contexts/identity/application/queries/get_openid_configuration/handler';
import { GetJwksQueryHandler } from '../../src/contexts/identity/application/queries/get_jwks/handler';
import { DiscoveryController } from './rest/v1/oidc/discovery_controller';
import { RefreshSessionRepositoryPort } from '../../src/contexts/identity/domain/ports/repositories/refresh_session_repository_port';
import { InMemoryRefreshSessionRepository } from '../../src/contexts/identity/infrastructure/persistence/repositories/refresh_session/in_memory_repository';
import { RotateRefreshTokenCommandHandler } from '../../src/contexts/identity/application/commands/rotate_refresh_token/handler';
import { RevokeSessionCommandHandler } from '../../src/contexts/identity/application/commands/revoke_session/handler';
import { OAuth2SessionController } from './rest/v1/oauth2/session_controller';
import { ExternalIdentityProviderPort } from '../../src/contexts/identity/domain/ports/external_identity_provider_port';
import { FederationStateManager } from '../../src/contexts/identity/infrastructure/federation/federation_state_manager';
import { GoogleOidcAdapter } from '../../src/contexts/identity/infrastructure/federation/google_oidc_adapter';
import { MicrosoftEntraAdapter } from '../../src/contexts/identity/infrastructure/federation/microsoft_entra_adapter';
import { GenerateFederatedLoginUrlQueryHandler } from '../../src/contexts/identity/application/queries/generate_federated_login_url/handler';
import { ProcessFederatedCallbackCommandHandler } from '../../src/contexts/identity/application/commands/process_federated_callback/handler';
import { FederationController } from './rest/v1/federation/federation_controller';

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
  authCodeRepository?: AuthorizationCodeRepositoryPort;
  refreshSessionRepository?: RefreshSessionRepositoryPort;
  hashProvider?: HashProviderPort;
  tokenProvider?: TokenProviderPort;
  asymmetricKeyProvider?: AsymmetricKeyProviderPort;
  cacheProvider?: CacheProviderPort;
  transactionRunner?: TenantTransactionRunnerPort;
  auditLogger?: SecurityAuditLoggerPort;
  googleOidcAdapter?: ExternalIdentityProviderPort;
  microsoftEntraAdapter?: ExternalIdentityProviderPort;
  federationStateManager?: FederationStateManager;
}

/**
 * Factoría de la aplicación Express (Driver Adapter HTTP).
 * Permite inyección de dependencias para tests y entornos productivos.
 */
export function createApp(deps?: AppDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Middleware ligero para parsing de cookies sin dependencias externas
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.cookies) {
      const cookieHeader = req.headers.cookie;
      const cookies: Record<string, string> = {};
      if (cookieHeader) {
        cookieHeader.split(';').forEach((cookie) => {
          const [name, ...rest] = cookie.trim().split('=');
          if (name) {
            cookies[name] = decodeURIComponent(rest.join('='));
          }
        });
      }
      req.cookies = cookies;
    }
    next();
  });

  let pool: Pool | null = null;
  const getPool = (): Pool => {
    if (!pool) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
    return pool;
  };

  let userRepository = deps?.userRepository;
  if (!userRepository) {
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      userRepository = new PostgresUserRepository(getPool());
    } else {
      userRepository = new InMemoryUserRepository();
    }
  }

  let clientRepository = deps?.clientRepository;
  if (!clientRepository) {
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      clientRepository = new PostgresClientApplicationRepository(getPool());
    } else {
      clientRepository = new InMemoryClientApplicationRepository(true);
    }
  }

  let authCodeRepository = deps?.authCodeRepository;
  if (!authCodeRepository) {
    authCodeRepository = new InMemoryAuthorizationCodeRepository();
  }

  let refreshSessionRepository = deps?.refreshSessionRepository;
  if (!refreshSessionRepository) {
    refreshSessionRepository = new InMemoryRefreshSessionRepository();
  }

  let transactionRunner = deps?.transactionRunner;
  if (!transactionRunner) {
    if (process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
      transactionRunner = new TenantAwareTransactionRunner(getPool());
    }
  }

  // Registrar dependencias e infraestructura en locals para extensibilidad del contenedor
  app.locals.userRepository = userRepository;
  app.locals.clientRepository = clientRepository;
  app.locals.authCodeRepository = authCodeRepository;
  app.locals.refreshSessionRepository = refreshSessionRepository;
  if (transactionRunner) {
    app.locals.transactionRunner = transactionRunner;
  }

  const hashProvider = deps?.hashProvider ?? new BcryptAdapter(6); // Rondas optimizadas para HTTP
  const jwtSecret = process.env.JWT_SECRET || 'default-jwt-secret-key-12345';
  const tokenProvider = deps?.tokenProvider ?? new JwtTokenAdapter(jwtSecret, '1h');
  const asymmetricKeyProvider =
    deps?.asymmetricKeyProvider ??
    new RsaKeyAdapter({
      privateKeyPem: process.env.RSA_PRIVATE_KEY_PEM,
      publicKeyPem: process.env.RSA_PUBLIC_KEY_PEM,
      keyId: process.env.RSA_KEY_ID,
    });
  app.locals.asymmetricKeyProvider = asymmetricKeyProvider;
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

  const auditLogger = deps?.auditLogger ?? new InMemorySecurityAuditLogger();
  app.locals.auditLogger = auditLogger;

  const authenticateClientM2MHandler = new AuthenticateClientM2MCommandHandler(
    clientRepository,
    hashProvider,
    tokenProvider,
    auditLogger,
    3600
  );

  const updateUserProfileHandler = new UpdateUserProfileCommandHandler(userRepository, cacheProvider);
  const getOpenIdConfigHandler = new GetOpenIdConfigurationQueryHandler(
    process.env.PUBLIC_ISSUER_URL || 'http://localhost:4000'
  );
  const getJwksHandler = new GetJwksQueryHandler(asymmetricKeyProvider);
  const discoveryController = new DiscoveryController(getOpenIdConfigHandler, getJwksHandler);

  const authController = new AuthController(registerUserHandler, getProfileHandler);
  const userController = new UserController(getProfileHandler, updateUserProfileHandler);
  const oauth2ClientController = new OAuth2ClientController(validateClientOriginHandler);

  const issueAuthCodeHandler = new IssueAuthorizationCodeCommandHandler(
    clientRepository,
    authCodeRepository,
    auditLogger
  );
  const exchangeAuthCodeHandler = new ExchangeAuthorizationCodeCommandHandler(
    clientRepository,
    authCodeRepository,
    hashProvider,
    asymmetricKeyProvider,
    auditLogger,
    900,
    process.env.PUBLIC_ISSUER_URL || 'http://localhost:4000'
  );
  const rotateRefreshTokenHandler = new RotateRefreshTokenCommandHandler(
    refreshSessionRepository,
    asymmetricKeyProvider,
    auditLogger,
    {
      issuerUrl: process.env.PUBLIC_ISSUER_URL || 'http://localhost:4000',
      tokenLifetimeSeconds: 900,
    }
  );
  const revokeSessionHandler = new RevokeSessionCommandHandler(refreshSessionRepository);

  const federationStateManager = deps?.federationStateManager ?? new FederationStateManager();
  const googleAdapter = deps?.googleOidcAdapter ?? new GoogleOidcAdapter();
  const microsoftAdapter = deps?.microsoftEntraAdapter ?? new MicrosoftEntraAdapter();
  const federationProviders = [googleAdapter, microsoftAdapter];

  const generateFederatedLoginUrlHandler = new GenerateFederatedLoginUrlQueryHandler(
    federationProviders,
    federationStateManager
  );
  const processFederatedCallbackHandler = new ProcessFederatedCallbackCommandHandler(
    federationProviders,
    federationStateManager,
    auditLogger
  );
  const federationController = new FederationController(
    generateFederatedLoginUrlHandler,
    processFederatedCallbackHandler
  );

  app.locals.federationStateManager = federationStateManager;
  app.locals.googleAdapter = googleAdapter;
  app.locals.microsoftAdapter = microsoftAdapter;

  const authorizeController = new OAuth2AuthorizeController(issueAuthCodeHandler);
  const sessionController = new OAuth2SessionController(rotateRefreshTokenHandler, revokeSessionHandler);
  const oauth2TokenController = new OAuth2TokenController(
    authenticateClientM2MHandler,
    exchangeAuthCodeHandler,
    rotateRefreshTokenHandler
  );
  const authMiddleware = createAuthMiddleware(tokenProvider, auditLogger);
  const crossTenantGuard = createCrossTenantGuard(auditLogger);

  // Rutas de Descubrimiento OIDC y JWKS (RFC 8414 & RFC 7517)
  app.get('/.well-known/openid-configuration', discoveryController.getOpenIdConfiguration);
  app.get('/.well-known/jwks.json', discoveryController.getJwks);

  // Rutas de Identidad y Autenticación v1
  app.post('/api/v1/auth/register', tenantContextMiddleware, authController.register);
  app.get('/api/v1/auth/me', tenantContextMiddleware, authMiddleware, authController.getProfile);

  // Rutas de Usuarios con Zero-Trust Guard & Anti-Enumeration (US-06)
  app.get(
    '/api/v1/users/:userId',
    tenantContextMiddleware,
    authMiddleware,
    crossTenantGuard,
    userController.getUserById
  );
  app.patch(
    '/api/v1/users/:userId',
    tenantContextMiddleware,
    authMiddleware,
    crossTenantGuard,
    userController.updateUser
  );

  // Rutas OAuth2 / Client Registry v1
  app.post(
    '/api/v1/oauth2/clients/validate',
    clientAuthorizationMiddleware(validateClientOriginHandler),
    oauth2ClientController.validateClientOrigin
  );

  // Rutas OAuth2 Authorize (RFC 6749 & RFC 7636)
  app.get('/oauth2/authorize', authorizeController.authorize);
  app.post('/oauth2/authorize', authorizeController.authorize);
  app.get('/api/v1/oauth2/authorize', authorizeController.authorize);
  app.post('/api/v1/oauth2/authorize', authorizeController.authorize);

  // Rutas OAuth2 Token (RFC 6749 & RFC 7636)
  app.post('/api/v1/oauth2/token', oauth2TokenController.issueToken);
  app.post('/oauth2/token', oauth2TokenController.issueToken);

  // Rutas de Sesión y Rotación de Refresh Tokens (US-09 & RFC 6749 / RFC 7009)
  app.post('/oauth2/refresh', sessionController.refresh);
  app.post('/api/v1/oauth2/refresh', sessionController.refresh);
  app.post('/oauth2/revoke', sessionController.revoke);
  app.post('/api/v1/oauth2/revoke', sessionController.revoke);

  // Rutas de Identidad Federada (External OIDC Providers - US-10)
  app.get('/api/v1/auth/federation/:provider/login', federationController.login);
  app.get('/api/v1/auth/federation/:provider/callback', federationController.callback);
  app.post('/api/v1/auth/federation/:provider/callback', federationController.callback);
  app.get('/auth/federation/:provider/login', federationController.login);
  app.get('/auth/federation/:provider/callback', federationController.callback);
  app.post('/auth/federation/:provider/callback', federationController.callback);

  // Cargar especificación OpenAPI declarativa y montar Swagger UI
  const openApiYamlPath = path.resolve(__dirname, '../../docs/openapi.yaml');
  let openApiSpec: any = null;
  if (fs.existsSync(openApiYamlPath)) {
    try {
      const openApiContent = fs.readFileSync(openApiYamlPath, 'utf8');
      openApiSpec = yaml.parse(openApiContent);
    } catch (e) {
      console.error('Failed to parse openapi.yaml:', e);
    }
  }

  if (openApiSpec) {
    app.get('/api/docs/openapi.json', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.json(openApiSpec);
    });
    app.get('/api/docs/openapi.yaml', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/yaml');
      res.sendFile(openApiYamlPath);
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  }

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
