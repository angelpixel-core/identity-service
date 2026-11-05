Feature: Get Tenant User Profile

  Scenario: Successful profile retrieval with Cache Miss and Cache Hit
    Given an authenticated user with a valid JWT token for tenant "acme-corp"
    And the user profile is not cached in memory
    When the client sends a GET request to "/api/v1/auth/me" with Bearer token
    Then the response status code should be 200 OK
    And the response body should contain the sanitized user profile
    And the cache should contain key "user_profile:acme-corp:user-id"

    When another GET request is sent to "/api/v1/auth/me" within cache TTL
    Then the response status code should be 200 OK
    And the response should be served from cache without querying database

  Scenario: Unauthorized profile access without JWT token
    Given an unauthenticated request without Authorization header
    When the client sends a GET request to "/api/v1/auth/me"
    Then the response status code should be 401 Unauthorized
    And the response body should contain an error message

  Scenario: Profile access with invalid or expired JWT token
    Given a request with an invalid or expired Bearer token
    When the client sends a GET request to "/api/v1/auth/me"
    Then the response status code should be 401 Unauthorized

