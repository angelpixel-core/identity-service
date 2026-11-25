Feature: Per-Tenant Federated Provider Registry (US-33)

  Scenario: Tenant admin registers B2B Okta provider without exposing secret on GET
    Given a tenant_admin session for "acme-corp"
    When the tenant_admin registers "okta-corp" via POST "/api/v1/tenants/acme-corp/federation/providers"
    Then the response status is 201 with hasClientSecret true and no raw secret
    And GET "/api/v1/tenants/acme-corp/federation/providers" returns "okta-corp" without exposing secrets

  Scenario: Cross-tenant admin cannot read or mutate another tenant's IdP registry
    Given a tenant_admin session for "globex"
    When requesting GET or POST on "/api/v1/tenants/acme-corp/federation/providers"
    Then the API rejects both requests with 403 Forbidden

  Scenario: Registered tenant IdP propagates to /api/v1/auth/config without secrets
    Given "portal-web" is bound to "acme-corp" and "okta-corp" is registered for "acme-corp"
    When requesting GET "/api/v1/auth/config?client_id=portal-web&tenant_id=acme-corp"
    Then federatedProviders includes "okta-corp" without exposing clientId or clientSecret
