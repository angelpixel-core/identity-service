import { randomUUID } from 'crypto';
import { RegisterUserCommand } from './command';
import { RegisterUserResponseDTO } from '../../dtos/register_user/dto';
import { UserRepositoryPort } from '../../ports/user/repository';
import { HashProviderPort } from '../../ports/security/hash_provider';
import { TokenProviderPort } from '../../ports/security/token_provider';
import { User } from '../../../domain/entities/user/aggregate';
import { Email } from '../../../domain/value_objects/email/value';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
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
    private readonly tokenProvider: TokenProviderPort
  ) {}

  public async execute(command: RegisterUserCommand): Promise<RegisterUserResponseDTO> {
    this.validatePassword(command.password);

    const email = Email.create(command.email);
    const tenantId = TenantId.create(command.tenantId);

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
    });

    await this.userRepository.save(newUser);

    const accessToken = await this.tokenProvider.generateToken({
      userId: newUser.getId(),
      email: newUser.getEmail().getValue(),
      tenantId: newUser.getTenantId().getValue(),
      roles: newUser.getRoles(),
      actorType: newUser.isSuperadmin() ? 'platform_operator' : 'user',
    });

    return {
      userId: newUser.getId(),
      email: newUser.getEmail().getValue(),
      tenantId: newUser.getTenantId().getValue(),
      roles: newUser.getRoles(),
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

