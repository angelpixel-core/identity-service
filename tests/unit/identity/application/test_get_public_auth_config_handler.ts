import { ClientApplication } from '../../../../src/contexts/identity/domain/entities/client_application/aggregate';
import { ClientTenantBinding } from '../../../../src/contexts/identity/domain/entities/client_tenant_binding/entity';
import { TenantPolicy } from '../../../../src/contexts/identity/domain/entities/tenant_policy/entity';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { OriginDomain } from '../../../../src/contexts/identity/domain/value_objects/origin_domain/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { OAuth2AuthenticationError } from '../../../../src/contexts/identity/domain/exceptions/oauth2/error';
import { InMemoryClientApplicationRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_application/in_memory_client_repository';
import { InMemoryClientTenantBindingRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/client_tenant_binding/in_memory_client_tenant_binding_repository';
import { InMemoryTenantPolicyRepository } from '../../../../src/contexts/identity/infrastructure/persistence/repositories/tenant_policy/in_memory_tenant_policy_repository';
import { MemoryCacheAdapter } from '../../../../src/contexts/identity/infrastructure/cache/memory_cache_adapter';
import { DefaultTenantFederatedProvidersAdapter } from '../../../../src/contexts/identity/application/ports/federation/tenant_federated_providers_port';
import { ResolveClientTenantContextQueryHandler } from '../../../../src/contexts/identity/application/queries/resolve_client_tenant_context/handler';
import {
  GetPublicAuthConfigQueryHandler,
  invalidateAuthConfigCacheForTenant,
} from '../../../../src/contexts/identity/application/queries/get_public_auth_config/handler';

describe('Unit: US-31 GetPublicAuthConfigQueryHandler', () => {
  const setup = async () => {
    const clientRepo = new InMemoryClientApplicationRepository();
    const bindingRepo = new InMemoryClientTenantBindingRepository();
    const policyRepo = new InMemoryTenantPolicyRepository();
    const cache = new MemoryCacheAdapter();

    const client = ClientApplication.create({
      id: 'cli-uuid-1',
      tenantId: 'system',
      clientId: ClientId.create('ecommerce-saas'),
      clientName: 'Ecommerce SaaS',
      clientType: 'public',
      clientProfile: 'spa',
      allowedOrigins: [OriginDomain.create('https://tienda-a.tusherramientas.com')],
      redirectUris: ['https://tienda-a.tusherramientas.com/callback'],
      allowedGrantTypes: ['authorization_code'],
      scopes: ['openid', 'profile'],
    });
    await clientRepo.save(client);

    await bindingRepo.save(
      ClientTenantBinding.create({
        id: '11111111-1111-4111-8111-111111111111',
        clientId: ClientId.create('ecommerce-saas'),
        tenantId: TenantId.create('tusherramientas-a'),
        customDomain: 'tienda-a.tusherramientas.com',
        allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
        allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
      })
    );

    const resolveHandler = new ResolveClientTenantContextQueryHandler(bindingRepo, clientRepo);
    const federatedPort = new DefaultTenantFederatedProvidersAdapter([
      {
        providerId: 'google',
        getAuthorizationUrl: async () => '',
        exchangeCodeAndVerifyToken: async () => ({
          provider: 'google',
          externalSubjectId: 's',
          email: 'e@x.com',
          emailVerified: true,
        }),
      },
    ]);

    const handler = new GetPublicAuthConfigQueryHandler(
      resolveHandler,
      policyRepo,
      federatedPort,
      cache
    );

    return { handler, policyRepo, cache };
  };

  it('should project default policy without secrets when no custom policy exists', async () => {
    const { handler } = await setup();

    const result = await handler.execute({
      clientId: 'ecommerce-saas',
      tenantId: 'tusherramientas-a',
    });

    expect(result.dto.tenantId).toBe('tusherramientas-a');
    expect(result.dto.requiredFields).toEqual(['email', 'password']);
    expect(result.dto.kycRequired).toBe(false);
    expect(result.dto.kycMinLevel).toBe('basic');
    expect(result.dto.federatedProviders).toEqual([
      { id: 'google', displayName: 'Google', protocol: 'oidc' },
    ]);
    expect(JSON.stringify(result.dto)).not.toContain('clientSecret');
    expect(result.etag).toBeTruthy();
  });

  it('should project custom policy (phone, biometric_liveness, federatedOidc=false) and serve from cache until invalidated', async () => {
    const { handler, policyRepo, cache } = await setup();

    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('tusherramientas-a'),
        requiredAttributes: { phone: true },
        kycPolicy: { required: true, minLevel: 'biometric_liveness' },
        allowedAuthMethods: { password: true, passkeys: false, federatedOidc: false },
        updatedBy: 'admin@tusherramientas-a.com',
      })
    );

    const findSpy = jest.spyOn(policyRepo, 'findByTenantId');

    const first = await handler.execute({
      clientId: 'ecommerce-saas',
      domain: 'tienda-a.tusherramientas.com',
    });
    expect(first.dto.requiredFields).toEqual(['email', 'password', 'phone']);
    expect(first.dto.kycRequired).toBe(true);
    expect(first.dto.kycMinLevel).toBe('biometric_liveness');
    expect(first.dto.federatedProviders).toEqual([]);
    expect(findSpy).toHaveBeenCalledTimes(1);

    // Cache hit: does not re-query policyRepo
    const second = await handler.execute({
      clientId: 'ecommerce-saas',
      tenantId: 'tusherramientas-a',
    });
    expect(second.etag).toBe(first.etag);
    expect(findSpy).toHaveBeenCalledTimes(1);

    // Mutate policy & invalidate cache
    await policyRepo.save(
      TenantPolicy.create({
        tenantId: TenantId.create('tusherramientas-a'),
        requiredAttributes: { phone: false },
        kycPolicy: { required: false, minLevel: 'basic' },
        allowedAuthMethods: { password: true, passkeys: true, federatedOidc: true },
        updatedBy: 'admin@tusherramientas-a.com',
      })
    );
    await invalidateAuthConfigCacheForTenant(cache, 'tusherramientas-a');

    const third = await handler.execute({
      clientId: 'ecommerce-saas',
      tenantId: 'tusherramientas-a',
    });
    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(third.dto.requiredFields).toEqual(['email', 'password']);
    expect(third.dto.federatedProviders.length).toBe(1);
    expect(third.etag).not.toBe(first.etag);
  });

  it('should reject unbound tenant with 403 forbidden_tenant_client_binding', async () => {
    const { handler } = await setup();

    await expect(
      handler.execute({
        clientId: 'ecommerce-saas',
        tenantId: 'unknown-tenant',
      })
    ).rejects.toThrow(OAuth2AuthenticationError);
  });
});
