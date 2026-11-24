Feature: Multi-Tenant / Multi-Domain Client Bindings and Explicit Tenant Resolution (US-29)

  Scenario: Multi-domain N:M client resolves distinct tenants by explicit domain
    Given a client "ecommerce-saas" bound to "tusherramientas-a" and "toolbox-b"
    When requesting GET "/api/v1/auth/config" with each domain
    Then each request resolves its corresponding tenantId

  Scenario: Unbound tenant is rejected with 403 forbidden_tenant_client_binding
    Given a client "ecommerce-saas" without binding for "academia-beisbol"
    When requesting GET "/api/v1/auth/config" with tenant_id "academia-beisbol"
    Then the response status is 403 with error "forbidden_tenant_client_binding"

  Scenario: Redirect URI belonging to another binding is rejected with 400 invalid_redirect_uri
    Given a binding for "tusherramientas-a"
    When requesting "/oauth2/authorize" with redirect_uri from "toolbox-b"
    Then the response status is 400 with error "invalid_redirect_uri"
