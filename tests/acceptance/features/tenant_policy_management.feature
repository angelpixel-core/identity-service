Feature: TenantPolicy Aggregate & Configurable Capabilities Management (US-30)

  Scenario: Returning safe default policy when no custom policy exists
    Given a tenant "acme-corp" without a persisted policy
    When an authenticated user requests GET "/api/v1/tenants/acme-corp/policy"
    Then the response status is 200 with isDefault true and all auth methods enabled

  Scenario: Updating policy as tenant_admin persists changes and emits audit event
    Given an authenticated "tenant_admin" for "acme-corp"
    When requesting PUT "/api/v1/tenants/acme-corp/policy" requiring phone and verified KYC
    Then the response status is 200 and subsequent GET returns the persisted policy
    And a TENANT_POLICY_UPDATED audit event is recorded

  Scenario: Rejecting policy modification from member or cross-tenant actor
    Given an authenticated "member" for "acme-corp"
    When requesting PUT "/api/v1/tenants/acme-corp/policy"
    Then the response status is 403 Forbidden

  Scenario: Rejecting policy that disables all authentication methods
    Given an authenticated "tenant_admin" for "acme-corp"
    When requesting PUT "/api/v1/tenants/acme-corp/policy" with all auth methods disabled
    Then the response status is 400 with error "invalid_tenant_policy"
