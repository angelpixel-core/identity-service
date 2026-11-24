Feature: WebAuthn / FIDO2 Passkey Registration (US-35)

  Scenario: Successful passkey registration stores COSE public key without biometric PII
    Given an authenticated user in tenant "acme-corp" with passkeys enabled
    When requesting registration options and verifying the attestation response
    Then the passkey is persisted with status 201 and listed without secrets

  Scenario: Reusing or missing a registration challenge is rejected
    Given an already consumed WebAuthn registration challenge
    When submitting a second verification request
    Then the response status is 400 with error "invalid_webauthn_challenge"

  Scenario: Tenant with passkeys disabled cannot register passkeys
    Given tenant "legacy-corp" with allowedAuthMethods.passkeys = false
    When requesting passkey registration options
    Then the response status is 403 with error "auth_method_disabled_for_tenant"
