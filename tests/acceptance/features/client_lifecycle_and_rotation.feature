Feature: Client Lifecycle Management and Dual-Grace Secret Rotation (US-28)

  Scenario: Confidential M2M registration returns secret once and never exposes hashes
    Given an authenticated tenant administrator for "acme-corp"
    When registering a new "m2m" client via POST "/api/v1/clients"
    Then the response status is 201 with a one-time "clientSecret"
    And subsequent GET "/api/v1/clients" queries never return "clientSecretHash"

  Scenario: Dual-grace secret rotation allows both old and new secrets without downtime
    Given an active confidential client with an existing secret
    When rotating the secret via POST "/api/v1/clients/:clientId/rotate-secret" with 300 seconds grace
    Then both the previous secret and the new secret authenticate against "/api/v1/oauth2/token"

  Scenario: Suspending a client blocks OAuth2 token issuance immediately
    Given an active confidential client
    When updating status to "suspended" via PATCH "/api/v1/clients/:clientId"
    Then POST "/api/v1/oauth2/token" rejects authentication with HTTP 401
