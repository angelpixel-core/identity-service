import { WebAuthnCredentialRepositoryPort } from '../../../domain/ports/webauthn_credential_repository_port';
import { TenantPolicy } from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { RefreshSession } from '../../../domain/entities/refresh_session/aggregate';
import { RefreshSessionRepositoryPort } from '../../../domain/ports/repositories/refresh_session_repository_port';
import { Email } from '../../../domain/value_objects/email/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { WebAuthnVerifierPort } from '../../ports/security/webauthn_verifier_port';
import { UserRepositoryPort } from '../../ports/user/repository';
import { ResolveClientTenantContextQueryHandler } from '../../queries/resolve_client_tenant_context/handler';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';

const AUTH_CHALLENGE_TTL_SECONDS = 300;

interface StoredAuthChallenge {
  readonly challenge: string;
  readonly rpID: string;
  readonly expectedOrigins: string[];
  readonly clientId?: string;
}

function authChallengeKey(tenantId: string, challenge: string): string {
  return `webauthn_auth:${tenantId}:${challenge}`;
}

function defaultWebAuthnRpId(): string {
  return (process.env.WEBAUTHN_RP_ID || 'localhost').trim();
}

function defaultWebAuthnOrigins(requestOrigin?: string): string[] {
  const configured = (process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000').trim();
  const origins = [configured];
  if (requestOrigin && !origins.includes(requestOrigin)) {
    origins.push(requestOrigin);
  }
  return origins;
}

function extractChallengeFromResponse(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, any>;
  if (typeof r.challenge === 'string' && r.challenge.trim()) {
    return r.challenge.trim();
  }
  const clientDataJSON = r.response?.clientDataJSON;
  if (typeof clientDataJSON === 'string' && clientDataJSON.trim()) {
    try {
      const padded = clientDataJSON.replace(/-/g, '+').replace(/_/g, '/');
      const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
      if (typeof parsed?.challenge === 'string') {
        return parsed.challenge;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface BeginPasskeyAuthenticationCommand {
  readonly tenantId: string;
  readonly email?: string;
  readonly clientId?: string;
  readonly origin?: string;
  readonly ip?: string;
}

export class BeginPasskeyAuthenticationCommandHandler {
  constructor(
    private readonly credentialRepository: WebAuthnCredentialRepositoryPort,
    private readonly userRepository: UserRepositoryPort,
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly verifier: WebAuthnVerifierPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly resolveContextHandler?: ResolveClientTenantContextQueryHandler
  ) {}

  public async execute(
    cmd: BeginPasskeyAuthenticationCommand
  ): Promise<Record<string, unknown> & { challenge: string }> {
    const tenantId = TenantId.create(cmd.tenantId);
    const persistedPolicy = await this.policyRepository.findByTenantId(tenantId);
    const policy = persistedPolicy ?? TenantPolicy.defaultFor(tenantId);

    if (!policy.getAllowedAuthMethods().passkeys) {
      throw new OAuth2AuthenticationError(
        'auth_method_disabled_for_tenant',
        `Passkeys are disabled for tenant "${tenantId.getValue()}"`,
        403
      );
    }

    let rpID = defaultWebAuthnRpId();
    let expectedOrigins = defaultWebAuthnOrigins(cmd.origin);

    if (cmd.clientId && this.resolveContextHandler) {
      const resolved = await this.resolveContextHandler.execute({
        clientId: cmd.clientId,
        tenantId: tenantId.getValue(),
        origin: cmd.origin,
        ip: cmd.ip,
      });
      if (resolved.customDomain) {
        rpID = resolved.customDomain;
      } else if (resolved.allowedCorsOrigins[0]) {
        rpID = new URL(resolved.allowedCorsOrigins[0]).hostname;
      }
      if (resolved.allowedCorsOrigins.length > 0) {
        expectedOrigins = [...resolved.allowedCorsOrigins];
      }
    } else if (cmd.origin) {
      try {
        rpID = new URL(cmd.origin).hostname;
      } catch {
        // fallback to defaultWebAuthnRpId()
      }
    }

    let allowCredentialIds: string[] = [];
    if (cmd.email && cmd.email.trim()) {
      const user = await this.userRepository.findByEmail(Email.create(cmd.email), tenantId);
      if (user) {
        const creds = await this.credentialRepository.findByUserAndTenant(user.getId(), tenantId);
        allowCredentialIds = creds.map((c) => c.getCredentialId());
      }
    }

    if (!this.verifier.generateAuthenticationOptions) {
      throw new Error('WebAuthnVerifierPort.generateAuthenticationOptions is not configured');
    }

    const options = await this.verifier.generateAuthenticationOptions({
      rpID,
      allowCredentialIds,
    });

    const stored: StoredAuthChallenge = {
      challenge: options.challenge,
      rpID,
      expectedOrigins,
      clientId: cmd.clientId,
    };

    await this.cacheProvider.set(
      authChallengeKey(tenantId.getValue(), options.challenge),
      stored,
      AUTH_CHALLENGE_TTL_SECONDS
    );

    return options;
  }
}

export interface VerifyPasskeyAuthenticationCommand {
  readonly tenantId: string;
  readonly response: unknown;
  readonly challenge?: string;
  readonly clientId?: string;
  readonly origin?: string;
  readonly ip?: string;
}

export interface PasskeyAuthSuccessDTO {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly amr: readonly string[];
}

export class VerifyPasskeyAuthenticationCommandHandler {
  constructor(
    private readonly credentialRepository: WebAuthnCredentialRepositoryPort,
    private readonly userRepository: UserRepositoryPort,
    private readonly policyRepository: TenantPolicyRepositoryPort,
    private readonly verifier: WebAuthnVerifierPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly tokenProvider: TokenProviderPort,
    private readonly refreshSessionRepository?: RefreshSessionRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(cmd: VerifyPasskeyAuthenticationCommand): Promise<PasskeyAuthSuccessDTO> {
    const tenantId = TenantId.create(cmd.tenantId);
    const persistedPolicy = await this.policyRepository.findByTenantId(tenantId);
    const policy = persistedPolicy ?? TenantPolicy.defaultFor(tenantId);

    if (!policy.getAllowedAuthMethods().passkeys) {
      throw new OAuth2AuthenticationError(
        'auth_method_disabled_for_tenant',
        `Passkeys are disabled for tenant "${tenantId.getValue()}"`,
        403
      );
    }

    const challenge = cmd.challenge?.trim() || extractChallengeFromResponse(cmd.response);
    if (!challenge) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_AUTH_FAILED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        ip: cmd.ip,
        timestamp: new Date(),
        reason: 'missing_challenge',
      });
      throw new OAuth2AuthenticationError('invalid_grant', 'Missing WebAuthn challenge', 401);
    }

    const key = authChallengeKey(tenantId.getValue(), challenge);
    const stored = await this.cacheProvider.get<StoredAuthChallenge>(key);
    await this.cacheProvider.delete(key);

    if (!stored) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_AUTH_FAILED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        ip: cmd.ip,
        timestamp: new Date(),
        reason: 'expired_or_consumed_challenge',
      });
      throw new OAuth2AuthenticationError(
        'invalid_grant',
        'WebAuthn authentication challenge expired or already consumed',
        401
      );
    }

    const rawResponse = (cmd.response ?? {}) as Record<string, any>;
    const credentialId = typeof rawResponse.id === 'string' ? rawResponse.id : '';
    const credential = credentialId
      ? await this.credentialRepository.findByCredentialId(credentialId, tenantId)
      : null;

    if (!credential) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_AUTH_FAILED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        ip: cmd.ip,
        timestamp: new Date(),
        reason: 'credential_not_found',
      });
      throw new OAuth2AuthenticationError('invalid_grant', 'Unknown Passkey credential', 401);
    }

    if (!this.verifier.verifyAuthenticationResponse) {
      throw new Error('WebAuthnVerifierPort.verifyAuthenticationResponse is not configured');
    }

    let verification;
    try {
      verification = await this.verifier.verifyAuthenticationResponse({
        response: cmd.response,
        expectedChallenge: stored.challenge,
        expectedOrigin: stored.expectedOrigins,
        expectedRPID: stored.rpID,
        credential: {
          id: credential.getCredentialId(),
          publicKeyCose: credential.getPublicKeyCose(),
          counter: credential.getCounter(),
          transports: credential.getTransports(),
        },
      });
    } catch (err) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_AUTH_FAILED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: credential.getUserId(), type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: err instanceof Error ? err.message : 'assertion_verification_failed',
      });
      throw new OAuth2AuthenticationError('invalid_grant', 'Passkey verification failed', 401);
    }

    if (!verification.verified) {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_AUTH_FAILED',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: credential.getUserId(), type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: 'assertion_not_verified',
      });
      throw new OAuth2AuthenticationError('invalid_grant', 'Passkey verification failed', 401);
    }

    try {
      credential.recordAssertionCounter(verification.newCounter);
    } catch {
      await this.auditLogger.logEvent({
        eventType: 'PASSKEY_CLONE_DETECTED',
        severity: 'CRITICAL',
        status: 'DENIED',
        tenantId: tenantId.getValue(),
        actor: { userId: credential.getUserId(), type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: 'sign_count_regression',
        details: {
          credentialId: credential.getCredentialId(),
          storedCounter: credential.getCounter(),
          receivedCounter: verification.newCounter,
        },
      });
      throw new OAuth2AuthenticationError(
        'invalid_grant',
        'Passkey clone detected (signCount regression)',
        401
      );
    }

    await this.credentialRepository.save(credential);

    const user = await this.userRepository.findById(credential.getUserId(), tenantId);
    if (!user) {
      throw new OAuth2AuthenticationError('invalid_grant', 'User account not found', 401);
    }

    const amr = ['hwk', 'user'] as const;
    const effectiveClientId = cmd.clientId ?? stored.clientId;
    const accessToken = await this.tokenProvider.generateToken({
      userId: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      roles: user.getRoles(),
      actorType: user.isSuperadmin() ? 'platform_operator' : 'user',
      claims: {
        amr: [...amr],
        ...(effectiveClientId ? { client_id: effectiveClientId } : {}),
      },
    });

    let refreshToken: string | undefined;
    if (this.refreshSessionRepository) {
      const created = RefreshSession.create({
        userId: user.getId(),
        tenantId: user.getTenantId(),
        clientId: effectiveClientId || 'portal-web',
      });
      await this.refreshSessionRepository.save(created.session);
      refreshToken = created.plainToken;
    }

    await this.auditLogger.logEvent({
      eventType: 'PASSKEY_AUTH_SUCCESS',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: tenantId.getValue(),
      actor: { userId: user.getId(), type: 'USER', ip: cmd.ip },
      timestamp: new Date(),
      details: {
        credentialId: credential.getCredentialId(),
        amr: [...amr],
      },
    });

    return {
      accessToken,
      refreshToken,
      userId: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      roles: user.getRoles(),
      amr: [...amr],
    };
  }
}
