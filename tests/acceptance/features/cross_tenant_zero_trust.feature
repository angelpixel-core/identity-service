Feature: Cross-Tenant Zero-Trust Data Access Guard & Audit

  Scenario: Prevent user enumeration across tenant boundaries
    Given an authenticated user belonging to tenant "alpha-corp"
    And an existing user profile with ID "user-999" belonging to tenant "beta-corp"
    When the user requests "/api/v1/users/user-999"
    Then the system should respond with HTTP 404 Not Found
    And no profile data of "beta-corp" should be disclosed

  Scenario: Block cross-tenant update attempts
    Given an authenticated user in tenant "alpha-corp"
    When the user attempts to update a profile in tenant "beta-corp"
    Then the operation must be aborted
    And a security audit event "CROSS_TENANT_VIOLATION" should be logged
