import { randomUUID } from 'crypto';
import { RegisterUserCommand } from './command';
import { RegisterUserResponseDTO } from '../../dtos/register_user/dto';
import { UserRepositoryPort } from '../../ports/user/repository';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { User } from '../../../domain/entities/user/aggregate';
import { Email } from '../../../domain/value_objects/email/value';
import { PhoneNumber } from '../../../domain/value_objects/phone_number/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { TenantPolicy } from '../../../domain/entities/tenant_policy/entity';
import { TenantPolicyRepositoryPort } from '../../../domain/ports/tenant_policy_repository_port';
import { OAuth2AuthenticationError } from '../../../domain/exceptions/oauth2/error';
import {
  DomainValidationError,
  ConflictError,
} from '../../../domain/exceptions/user/error';

/**
 * Command Handler: RegisterUserCommandHandler
 * Orquesta la lógica del caso de uso de registro de usuario (Write Slice).
 * Valida invariantes, verifica unicidad por tenant, hashea la contraseña,
 * persiste el agregado User y emite un token JWT autenticado con claims de tenant.
 */
export class RegisterUserCommandHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly hashProvider: HashProviderPort,
    private readonly tokenProvider: TokenProviderPort,
    private readonly policyRepository?: TenantPolicyRepositoryPort
  ) {}

  public async execute(command: RegisterUserCommand): Promise<RegisterUserResponseDTO> {
    this.validatePassword(command.password);

    const email = Email.create(command.email);
    const tenantId = TenantId.create(command.tenantId);

    if (this.policyRepository) {
      const persisted = await this.policyRepository.findByTenantId(tenantId);
      const policy = persisted ?? TenantPolicy.defaultFor(tenantId);

      if (!policy.getAllowedAuthMethods().password) {
        throw new OAuth2AuthenticationError(
          'auth_method_disabled_for_tenant',
          `Password registration is disabled for tenant "${tenantId.getValue()}"`,
          403
        );
      }

      const rawPhone = typeof command.phone === 'string' ? command.phone.trim() : '';
      if (policy.getRequiredAttributes().phone && rawPhone.length === 0) {
        throw new DomainValidationError(
          `Phone number in E.164 format is required for tenant "${tenantId.getValue()}"`
        );
      }
    }

    const rawPhone = typeof command.phone === 'string' ? command.phone.trim() : '';
    const phone = rawPhone.length > 0 ? PhoneNumber.create(rawPhone) : null;

    const existingUser = await this.userRepository.findByEmail(email, tenantId);
    if (existingUser) {
      throw new ConflictError(
        `User with email "${email.getValue()}" already exists in tenant "${tenantId.getValue()}"`
      );
    }

    const isRootTenant = tenantId.isRoot();
    const requestedRoles = command.roles || (isRootTenant ? ['superadmin', 'member'] : ['member']);

    if (requestedRoles.includes('superadmin') && !isRootTenant) {
      throw new DomainValidationError('Role "superadmin" can only be assigned within the root tenant ("system")');
    }

    const passwordHash = await this.hashProvider.hash(command.password);

    const userId = randomUUID();
    const newUser = User.create({
      id: userId,
      email,
      tenantId,
      passwordHash,
      roles: requestedRoles,
      phone,
    });

    await this.userRepository.save(newUser);

    const accessToken = await this.tokenProvider.generateToken({
      userId: newUser.getId(),
      email: newUser.getEmail().getValue(),
      tenantId: newUser.getTenantId().getValue(),
      roles: newUser.getRoles(),
      actorType: newUser.isSuperadmin() ? 'platform_operator' : 'user',
    });

    const phoneValue = newUser.getPhone()?.getValue();
    return {
      userId: newUser.getId(),
      email: newUser.getEmail().getValue(),
      tenantId: newUser.getTenantId().getValue(),
      roles: newUser.getRoles(),
      ...(phoneValue ? { phone: phoneValue } : {}),
      accessToken,
    };
  }

  private validatePassword(password: string): void {
    if (!password || typeof password !== 'string' || password.trim().length === 0) {
      throw new DomainValidationError('Password must be a non-empty string');
    }

    if (password.length < 8) {
      throw new DomainValidationError('Password must be at least 8 characters long');
    }
  }
}

