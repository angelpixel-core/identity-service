import { UserRepositoryPort } from '../../ports/user/repository';
import { CacheProviderPort } from '../../ports/cache/cache_provider';
import { TenantId } from '../../../domain/value_objects/tenant_id/value';
import { GetUserProfileQuery } from './query';
import { UserProfileDTO } from '../../dtos/user_profile/dto';

/**
 * Caso de uso (Read Slice): Consulta de perfil de usuario multi-tenant con patrón Cache-Aside.
 * 1. Intenta recuperar el perfil desde la caché rápida (Cache Hit).
 * 2. En caso de fallo (Cache Miss), consulta al repositorio en base de datos.
 * 3. Almacena en caché el resultado sanitizado con un TTL configurado.
 */
export class GetUserProfileQueryHandler {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly cacheProvider: CacheProviderPort,
    private readonly defaultTtlSeconds: number = 300
  ) {}

  public async execute(query: GetUserProfileQuery): Promise<UserProfileDTO> {
    const { profile } = await this.executeWithMeta(query);
    return profile;
  }

  public async executeWithMeta(
    query: GetUserProfileQuery
  ): Promise<{ readonly profile: UserProfileDTO; readonly cacheStatus: 'HIT' | 'MISS' }> {
    const cacheKey = `user_profile:${query.tenantId}:${query.userId}`;

    // 1. Intento de lectura desde caché
    const cachedProfile = await this.cacheProvider.get<UserProfileDTO>(cacheKey);
    if (cachedProfile) {
      return { profile: cachedProfile, cacheStatus: 'HIT' };
    }

    // 2. Cache Miss: Consulta a la persistencia respetando el aislamiento multi-tenant
    const tenantId = TenantId.create(query.tenantId);
    const user = await this.userRepository.findById(query.userId, tenantId);

    if (!user) {
      throw new Error(`User not found in tenant ${query.tenantId}`);
    }

    // 3. Mapeo a DTO sanitizado (sin credenciales ni datos sensibles)
    const phoneValue = user.getPhone()?.getValue();
    const profileDto: UserProfileDTO = {
      id: user.getId(),
      email: user.getEmail().getValue(),
      tenantId: user.getTenantId().getValue(),
      ...(phoneValue ? { phone: phoneValue } : {}),
      createdAt: user.getCreatedAt(),
      updatedAt: user.getUpdatedAt(),
    };

    // 4. Poblar caché con TTL
    await this.cacheProvider.set(cacheKey, profileDto, this.defaultTtlSeconds);

    return { profile: profileDto, cacheStatus: 'MISS' };
  }
}

