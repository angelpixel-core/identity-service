import { UserRepositoryPort } from '../../ports/user/repository';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { InMemorySecurityAuditLogger } from '../../../infrastructure/logging/memory_security_audit_logger';
import { TenantPolicy } from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { Email } from '../../../domain/value_objects/email/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';

export interface LoginUserCommand {
  readonly tenantId: string;
  readonly email: string;
  readonly password: string;
  readonly ip?: string;
}

export interface LoginUserResponseDTO {
  readonly userId: string;
  readonly email: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly phone: string | null;
  readonly accessToken: string;
}

/**
 * Command Handler: LoginUser (US-32)
 * Autentica un usuario local con email + password respetando TenantPolicy (allowedAuthMethods.password)
 * y registrando eventos de auditoría AUTH_LOGIN_SUCCESS / AUTH_LOGIN_FAILURE.
 */
export class LoginUserCommandHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly tokenProvider: TokenProviderPort,
    private readonly policyRepository?: TenantPolicyRepositoryPort,
    private readonly auditLogger: SecurityAuditLoggerPort = new InMemorySecurityAuditLogger()
  ) {}

  public async execute(cmd: LoginUserCommand): Promise<LoginUserResponseDTO> {
    const email = Email.create(cmd.email);
    const tenantId = TenantId.create(cmd.tenantId);

    if (this.policyRepository) {
      const persisted = await this.policyRepository.findByTenantId(tenantId);
      const policy = persisted ?? TenantPolicy.defaultFor(tenantId);

      if (!policy.getAllowedAuthMethods().password) {
        await this.auditLogger.logEvent({
          eventType: 'AUTH_LOGIN_FAILURE',
          severity: 'WARN',
          status: 'DENIED',
          tenantId: tenantId.getValue(),
          ip: cmd.ip,
          timestamp: new Date(),
          reason: 'auth_method_disabled_for_tenant',
          details: { email: email.getValue(), method: 'password' },
        });
        throw new OAuth2AuthenticationError(
          'auth_method_disabled_for_tenant',
          `Password login is disabled for tenant "${tenantId.getValue()}"`,
          403
        );
      }
    }

    const user = await this.userRepository.findByEmail(email, tenantId);
    if (!user || !user.hasLocalPassword()) {
      await this.auditLogger.logEvent({
        eventType: 'AUTH_LOGIN_FAILURE',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        ip: cmd.ip,
        timestamp: new Date(),
        reason: 'invalid_credentials',
        details: { email: email.getValue() },
      });
      throw new OAuth2AuthenticationError(
        'invalid_credentials',
        'Invalid email or password',
        401
      );
    }

    const passwordMatches = await this.hashProvider.compare(cmd.password, user.getPasswordHash());
    if (!passwordMatches) {
      await this.auditLogger.logEvent({
        eventType: 'AUTH_LOGIN_FAILURE',
        severity: 'WARN',
        status: 'FAILURE',
        tenantId: tenantId.getValue(),
        actor: { userId: user.getId(), type: 'USER', ip: cmd.ip },
        timestamp: new Date(),
        reason: 'invalid_credentials',
        details: { email: email.getValue() },
      });
      throw new OAuth2AuthenticationError(
        'invalid_credentials',
        'Invalid email or password',
        401
      );
    }

    const accessToken = await this.tokenProvider.generateToken({
      userId: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      roles: user.getRoles(),
      actorType: user.isSuperadmin() ? 'platform_operator' : 'user',
    });

    await this.auditLogger.logEvent({
      eventType: 'AUTH_LOGIN_SUCCESS',
      severity: 'INFO',
      status: 'SUCCESS',
      tenantId: user.getTenantId().getValue(),
      actor: { userId: user.getId(), type: user.isSuperadmin() ? 'OPERATOR' : 'USER', ip: cmd.ip },
      timestamp: new Date(),
      details: { email: user.getEmail().getValue(), method: 'password' },
    });

    return {
      userId: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      roles: user.getRoles(),
      phone: user.getPhone()?.getValue() ?? null,
      accessToken,
    };
  }
}
