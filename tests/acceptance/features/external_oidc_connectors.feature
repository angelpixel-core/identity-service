Feature: External OIDC Provider Connectors (Google & Microsoft Entra ID - US-10)
  As a tenant user or administrator
  I want to authenticate via external identity providers such as Google or Microsoft
  So that I can access my tenant workspace securely without managing additional local passwords

  Background:
    Given the identity service is running and healthy
    And a registered public client "client-web-portal" with redirect URI "https://portal.local/callback"

  Scenario: Initiate Google federated authentication with cryptographic state and nonce
    When the client requests federated login via provider "google" for tenant "acme-corp" with redirect URI "https://portal.local/callback"
    Then the system should generate an authorization URL pointing to Google Accounts
    And the URL must contain a valid cryptographic "state" parameter and "nonce"
    And the URL must include required scopes "openid email profile"

  Scenario: Initiate Microsoft Entra federated authentication
    When the client requests federated login via provider "microsoft" for tenant "acme-corp" with redirect URI "https://portal.local/callback"
    Then the system should generate an authorization URL pointing to Microsoft Entra ID
    And the URL must contain a valid cryptographic "state" parameter and "nonce"

  Scenario: Successfully validate Google callback and parse verified profile
    Given a valid authorization code from Google and matching "state" parameter
    When the callback endpoint processes the response
    Then the ID Token signature should be verified against the provider JWKS
    And the normalized user profile should contain email and "email_verified": true

  Scenario: Reject callback when cryptographic state is invalid or tampered
    Given an authorization code from Google with tampered "state" parameter
    When the callback endpoint processes the response
    Then the system should reject the request with HTTP 400 Bad Request
    And the error description should state "Anti-CSRF state verification failed"

  Scenario: Reject callback when external profile email is not verified
    Given an authorization code from Google where the email is not verified
    When the callback endpoint processes the response
    Then the system should reject the request with HTTP 401 Unauthorized
    And the error description should indicate unverified email

