Feature: Tenant User Registration

  Scenario: Successful tenant user registration
    Given the tenant "acme-corp" exists and is active
    When the client sends a POST request to "/api/v1/auth/register" with:
      | tenantId | acme-corp          |
      | email    | user@acme.com      |
      | password | SecurePass123!     |
    Then the response status code should be 201 Created
    And the response body should contain a valid JWT access token
    And the JWT token claims should contain "tenantId": "acme-corp"

  Scenario: Registration failure due to invalid email format
    Given a client attempting registration
    When the client submits "invalid-email-format" as email
    Then the system should throw a DomainValidationError
    And the response status code should be 400 Bad Request
    And no record should be persisted in the database

  Scenario: Registration failure due to duplicate email in same tenant
    Given an existing user "user@acme.com" registered in tenant "acme-corp"
    When another user attempts to register with "user@acme.com" in tenant "acme-corp"
    Then the system should catch a ConflictError
    And the response status code should be 409 Conflict
