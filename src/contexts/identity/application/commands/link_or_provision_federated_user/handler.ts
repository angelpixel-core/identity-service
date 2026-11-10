import { UserRepositoryPort } from '../../ports/user/repository';
import { FederatedIdentityRepositoryPort } from '../../../domain/ports/repositories/federated_identity_repository_port';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { RefreshSessionRepositoryPort } from '../../../domain/ports/repositories/refresh_session_repository_port';
import { SecurityAuditLoggerPort } from '../../ports/security/audit_logger';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { Email } from '../../../domain/value_objects/email/value';
import { User } from '../../../domain/entities/user/aggregate';
import { FederatedIdentity } from '../../../domain/entities/federated_identity/aggregate';
import { RefreshSession } from '../../../domain/entities/refresh_session/aggregate';
import { LinkOrProvisionFederatedUserCommand } from './command';
import { FederatedUserSessionResultDTO } from './dto';

export class LinkOrProvisionFederatedUserCommandHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly federatedIdentityRepository: FederatedIdentityRepositoryPort,
    private readonly tokenProvider: TokenProviderPort,
    private readonly refreshSessionRepository: RefreshSessionRepositoryPort,
    private readonly auditLogger?: SecurityAuditLoggerPort
  ) { }

  public async execute(
    command: LinkOrProvisionFederatedUserCommand
  ): Promise<FederatedUserSessionResultDTO> {
    const { userProfile, clientId, ip } = command;

    if (!userProfile.emailVerified) {
      await this.auditLogger?.logEvent({
        eventType: 'federation_callback_failed',
        timestamp: new Date(),
        ip,
        reason: 'Unverified external email: email_verified must be true',
        metadata: {
          provider: userProfile.provider,
          email: userProfile.email,
          tenantId: command.tenantId,
        },
      });
      throw new Error(`Cannot link or provision account: ${userProfile.provider} email "${userProfile.email}" is not verified`);
    }

    const tenantId = TenantId.create(command.tenantId);
    const email = Email.create(userProfile.email);

    let user: User | null = null;
    let isNewUser = false;
    let linked = false;

    // 1. Verificar si ya existe una identidad federada para este par (provider, externalSubjectId)
    const existingIdentity = await this.federatedIdentityRepository.findByProviderAndSubject(
      userProfile.provider,
      userProfile.externalSubjectId
    );

    if (existingIdentity) {
      // Verificar que el tenant coincide
      if (!existingIdentity.belongsToTenant(tenantId)) {
        await this.auditLogger?.logEvent({
          eventType: 'cross_tenant_violation',
          timestamp: new Date(),
          ip,
          reason: 'CROSS_TENANT_VIOLATION: Federated identity belongs to a different tenant',
          metadata: {
            identityTenantId: existingIdentity.getTenantId().getValue(),
            attemptedTenantId: tenantId.getValue(),
            provider: userProfile.provider,
            subject: userProfile.externalSubjectId,
          },
        });
        throw new Error('Federated identity belongs to another tenant organization');
      }

      user = await this.userRepository.findById(existingIdentity.getUserId(), tenantId);
      if (!user) {
        throw new Error(`Inconsistent federated state: linked user "${existingIdentity.getUserId()}" not found`);
      }

      isNewUser = false;
      linked = false;

      await this.auditLogger?.logEvent({
        eventType: 'client_authenticated',
        clientId: clientId || userProfile.provider,
        timestamp: new Date(),
        ip,
        metadata: {
          userId: user.getId(),
          tenantId: tenantId.getValue(),
          provider: userProfile.provider,
          subject: userProfile.externalSubjectId,
          method: 'federation_existing_link',
        },
      });
    } else {
      // 2. No existe vínculo previo. Verificar si ya existe un usuario local con el mismo correo verificado
      const existingUserByEmail = await this.userRepository.findByEmail(email, tenantId);

      if (existingUserByEmail) {
        // Vinculación a cuenta local preexistente (Account Linking)
        user = existingUserByEmail;
        isNewUser = false;
        linked = true;

        const newIdentity = FederatedIdentity.create({
          userId: user.getId(),
          tenantId,
          provider: userProfile.provider,
          externalSubjectId: userProfile.externalSubjectId,
          externalEmail: email,
        });

        await this.federatedIdentityRepository.save(newIdentity);

        await this.auditLogger?.logEvent({
          eventType: 'client_authenticated',
          clientId: clientId || userProfile.provider,
          timestamp: new Date(),
          ip,
          metadata: {
            userId: user.getId(),
            tenantId: tenantId.getValue(),
            provider: userProfile.provider,
            subject: userProfile.externalSubjectId,
            method: 'federation_account_linked',
          },
        });
      } else {
        // 3. Creación Just-In-Time (JIT Provisioning)
        isNewUser = true;
        linked = true;

        user = User.createFederatedUser({
          email,
          tenantId,
        });

        await this.userRepository.save(user);

        const newIdentity = FederatedIdentity.create({
          userId: user.getId(),
          tenantId,
          provider: userProfile.provider,
          externalSubjectId: userProfile.externalSubjectId,
          externalEmail: email,
        });

        await this.federatedIdentityRepository.save(newIdentity);

        await this.auditLogger?.logEvent({
          eventType: 'client_authenticated',
          clientId: clientId || userProfile.provider,
          timestamp: new Date(),
          ip,
          metadata: {
            userId: user.getId(),
            tenantId: tenantId.getValue(),
            provider: userProfile.provider,
            subject: userProfile.externalSubjectId,
            method: 'federation_jit_provisioned',
          },
        });
      }
    }

    // 4. Emitir sesión nativa: Access Token RS256 & RefreshSession (Sliding Session)
    const effectiveClientId = clientId || `${userProfile.provider}-federated-client`;
    const nowEpoch = Math.floor(Date.now() / 1000);

    const accessToken = await this.tokenProvider.generateToken({
      userId: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      claims: {
        iss: 'https://auth.angelpixel.io',
        sub: user.getId(),
        tenant_id: user.getTenantId().getValue(),
        email: user.getEmail().getValue(),
        client_id: effectiveClientId,
        token_type: 'Bearer',
        auth_time: nowEpoch,
        provider: userProfile.provider,
      },
    });

    const { session, plainToken } = RefreshSession.create({
      userId: user.getId(),
      tenantId,
      clientId: effectiveClientId,
    });

    await this.refreshSessionRepository.save(session);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshToken: plainToken,
      user: {
        id: user.getId(),
        email: user.getEmail().getValue(),
        tenantId: user.getTenantId().getValue(),
      },
      isNewUser,
      linked,
      provider: userProfile.provider,
    };
  }
}
