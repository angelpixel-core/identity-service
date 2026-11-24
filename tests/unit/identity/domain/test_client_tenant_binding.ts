import { ClientTenantBinding } from '../../../../src/contexts/identity/domain/entities/client_tenant_binding/entity';
import { ClientId } from '../../../../src/contexts/identity/domain/value_objects/client_id/value';
import { TenantId } from '../../../../src/contexts/identity/domain/value_objects/tenant_id/value';
import { DomainValidationError } from '../../../../src/contexts/identity/domain/exceptions/user/error';

describe('Unit: US-29 ClientTenantBinding Domain & Domain Normalization', () => {
  it('should normalize customDomain to lowercase and validate exact redirect_uri and CORS origin matches', () => {
    const binding = ClientTenantBinding.create({
      id: '11111111-1111-4111-8111-111111111111',
      clientId: ClientId.create('ecommerce-saas'),
      tenantId: TenantId.create('tusherramientas-a'),
      customDomain: '  Tienda-A.TusHerramientas.COM ',
      allowedRedirectUris: ['https://tienda-a.tusherramientas.com/callback'],
      allowedCorsOrigins: ['https://tienda-a.tusherramientas.com'],
    });

    expect(binding.getCustomDomain()).toBe('tienda-a.tusherramientas.com');
    expect(binding.matchesRedirectUri('https://tienda-a.tusherramientas.com/callback')).toBe(true);
    expect(binding.matchesRedirectUri('https://toolbox-b.com/callback')).toBe(false);
    expect(binding.matchesCorsOrigin('https://tienda-a.tusherramientas.com')).toBe(true);
    expect(binding.matchesCorsOrigin('https://evil.example.com')).toBe(false);
  });

  it('should reject customDomain containing protocol, port, or path', () => {
    expect(() =>
      ClientTenantBinding.create({
        id: '22222222-2222-4222-8222-222222222222',
        clientId: ClientId.create('ecommerce-saas'),
        tenantId: TenantId.create('tusherramientas-a'),
        customDomain: 'https://tienda-a.tusherramientas.com/path',
      })
    ).toThrow(DomainValidationError);
  });

  it('should toggle active state on deactivate() and activate()', () => {
    const binding = ClientTenantBinding.create({
      id: '33333333-3333-4333-8333-333333333333',
      clientId: ClientId.create('ecommerce-saas'),
      tenantId: TenantId.create('toolbox-b'),
      customDomain: 'toolbox-b.com',
    });

    expect(binding.isActive()).toBe(true);
    binding.deactivate();
    expect(binding.isActive()).toBe(false);
    binding.activate();
    expect(binding.isActive()).toBe(true);
  });
});
