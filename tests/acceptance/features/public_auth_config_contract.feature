Feature: Public Dynamic Auth Config Contract (US-31)

  Scenario: Dynamic auth config for tusherramientas-a requires phone and KYC
    Given a client "ecommerce-saas" bound to "tusherramientas-a" with phone and KYC required
    When requesting GET "/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=tusherramientas-a"
    Then the response status is 200 with requiredFields including "phone", kycRequired true and no secrets

  Scenario: Dynamic auth config for academia-beisbol uses minimal required fields
    Given a client "ecommerce-saas" bound to "academia-beisbol" with default policy
    When requesting GET "/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=academia-beisbol"
    Then the response status is 200 with requiredFields ["email", "password"] and kycRequired false

  Scenario: Unbound tenant is rejected with 403 forbidden_tenant_client_binding
    Given a client "ecommerce-saas" without binding for "unknown-tenant"
    When requesting GET "/api/v1/auth/config?client_id=ecommerce-saas&tenant_id=unknown-tenant"
    Then the response status is 403 with error "forbidden_tenant_client_binding"
