Feature: Generic OIDC/OAuth2 Adapter and Multi-Tenant Runtime Resolution (US-34)

  Scenario: Okta B2B per-tenant login discovers JWKS and issues JWT with provider claim
    Given "okta-corp" is registered for tenant "acme-corp"
    When a user starts and completes federated login for "okta-corp" in "acme-corp"
    Then the system provisions the user JIT in "acme-corp" and emits JWT with provider "okta-corp"

  Scenario: Cross-tenant login attempt for an unregistered provider is rejected
    Given "okta-corp" is registered only for "acme-corp"
    When requesting federated login for "okta-corp" in "academia-beisbol"
    Then the API rejects the request with 400 invalid_request

  Scenario: Unverified external email is rejected with 401 invalid_grant
    Given "okta-corp" returns an id_token with email_verified false
    When completing the federated callback for "okta-corp"
    Then the API rejects with 401 invalid_grant
