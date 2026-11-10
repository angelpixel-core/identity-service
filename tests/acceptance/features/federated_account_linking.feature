Feature: Federated Account Linking and JIT Tenant Provisioning (US-11)

  As an authenticated user via an external identity provider (Google / Microsoft)
  I want my external identity to be linked to my existing account or provisioned Just-In-Time (JIT)
  So that I can immediately access the tenant application with native session tokens without manual pre-registration

  Scenario: Just-In-Time (JIT) user creation for new federated identity
    Given an external identity provider "google" with verified user "john.doe@example.com" and subject "g-sub-1001"
    And user "john.doe@example.com" does not exist in tenant "acme-corp"
    When the user completes federated authentication in tenant "acme-corp"
    Then a new User record should be provisioned in tenant "acme-corp" with email "john.doe@example.com"
    And a federated identity record linking "google" and "g-sub-1001" to the new user should be created
    And native RS256 access token and HttpOnly refresh token cookie should be issued
    And the response should indicate "isNewUser" is true and "linked" is true

  Scenario: Account linking with existing tenant user by verified email
    Given an existing local user "alice@acme.com" in tenant "acme-corp"
    And an external identity provider "microsoft" with verified email "alice@acme.com" and subject "ms-oid-2002"
    When Alice completes federated authentication in tenant "acme-corp"
    Then the system should link the "microsoft" identity to the existing user "alice@acme.com"
    And no duplicate User record should be created in tenant "acme-corp"
    And native RS256 access token and HttpOnly refresh token cookie should be issued
    And the response should indicate "isNewUser" is false and "linked" is true

  Scenario: Multiple external providers linked to the same local user
    Given an existing local user "bob@acme.com" in tenant "acme-corp" already linked to "google" with subject "g-sub-3001"
    When Bob completes federated authentication with provider "microsoft", email "bob@acme.com", and subject "ms-oid-3002" in tenant "acme-corp"
    Then the system should link the "microsoft" identity to Bob's existing user record
    And Bob should have 2 linked federated identities in tenant "acme-corp"
    And native session tokens should be issued for Bob

  Scenario: Existing federated identity signs in directly without relinking
    Given a user "charlie@acme.com" in tenant "acme-corp" with an existing linked "google" identity "g-sub-4001"
    When Charlie completes federated authentication with provider "google" and subject "g-sub-4001"
    Then the system should authenticate Charlie using the existing federated identity
    And no new user or federated identity record should be created
    And the response should indicate "isNewUser" is false and "linked" is false
    And native session tokens should be issued for Charlie

  Scenario: Reject account linking when external email is not verified
    Given an external identity provider "google" with unverified email "unverified@acme.com" and subject "g-sub-9999"
    When the user attempts federated authentication in tenant "acme-corp"
    Then the request should be rejected with HTTP 401 Unauthorized
    And no user or federated identity record should be created
