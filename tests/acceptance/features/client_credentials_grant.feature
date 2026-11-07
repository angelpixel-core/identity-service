Feature: Client Credentials Scoped Grant

  Scenario: Successful machine-to-machine authentication with authorized scopes
    Given a registered confidential client "order-service" with valid secret "ValidSecret123!_SuperSecureSecretForTesting_2026" and scopes ["identity:read"]
    When the client sends a POST request to "/api/v1/oauth2/token" with:
      | grant_type    | client_credentials |
      | client_id     | order-service       |
      | client_secret | ValidSecret123!_SuperSecureSecretForTesting_2026 |
      | scope         | identity:read       |
    Then the response status code should be 200 OK
    And the response body should contain an access_token of type "Bearer"
    And the response body should contain the granted scope "identity:read"

  Scenario: Rejection of client credentials request from a public client
    Given a registered public client "portal-web"
    When the client attempts to use "client_credentials" grant type
    Then the response status code should be 400 Bad Request
    And the response body error should be "unauthorized_client"

  Scenario: Rejection of unauthorized scopes
    Given a registered confidential client "analytics-worker" with scopes ["metrics:write"]
    When the client requests scope "identity:admin"
    Then the response status code should be 400 Bad Request
    And the response body error should be "invalid_scope"

  Scenario: Rejection of invalid client secret
    Given a registered confidential client "order-service"
    When the client sends invalid secret "WrongSecret123!_SuperSecureSecretForTesting_2026"
    Then the response status code should be 401 Unauthorized
    And the response body error should be "invalid_client"

