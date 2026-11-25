Feature: KYC Verification Adapter (KycVerificationPort) & RFC 9068 JWT Claims (US-37)

  Scenario: Starting a KYC session transitions user verification to PENDING
    Given an authenticated user in tenant "tusherramientas-a"
    When requesting POST "/api/v1/auth/kyc/sessions"
    Then the response status is 201 with status "PENDING" and a providerRef

  Scenario: Signed HMAC webhook updates status to VERIFIED and projects JWT claims
    Given an active PENDING KYC session
    When receiving a valid HMAC-signed webhook with verdict "VERIFIED"
    Then subsequent login issues a JWT with kyc_verified true and kyc_status "VERIFIED"

  Scenario: Invalid HMAC webhook signature is rejected with 401 invalid_signature
    Given an active PENDING KYC session
    When receiving a webhook with an invalid X-KYC-Signature
    Then the response status is 401 with error "invalid_signature"
