Feature: WebAuthn Passkey Authentication & RFC 9068 amr Claims (US-36)

  Scenario: Successful passkey authentication emits JWT with amr ["hwk", "user"]
    Given a user with a registered passkey in tenant "acme-corp"
    When completing /api/v1/auth/passkeys/login/{options,verify}
    Then the response status is 200 with amr ["hwk", "user"] and an HttpOnly refresh_token cookie

  Scenario: Passkey signCount regression triggers clone detection
    Given a singleDevice passkey with stored counter 2
    When verifying an assertion with counter 2
    Then the response status is 401 with error "invalid_grant"

  Scenario: Tenant with passkeys disabled rejects passkey authentication
    Given tenant "legacy-corp" with allowedAuthMethods.passkeys = false
    When requesting /api/v1/auth/passkeys/login/options
    Then the response status is 403 with error "auth_method_disabled_for_tenant"
