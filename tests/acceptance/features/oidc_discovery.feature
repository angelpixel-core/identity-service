Feature: Cryptographic Keypair Management, JWKS and OpenID Discovery Endpoints
  As a developer of client applications or consuming microservices in the ecosystem
  I want to retrieve standard OpenID discovery configuration and JSON Web Key Sets (JWKS)
  So that I can autonomously configure clients and cryptographically verify RS256 token signatures without shared secrets

  Scenario: Retrieve OpenID Connect Discovery metadata
    When a client sends a GET request to "/.well-known/openid-configuration"
    Then the response status code should be 200
    And the response body should contain "issuer" matching the service public URL
    And the response body should contain "jwks_uri" ending in "/.well-known/jwks.json"
    And the response body should indicate support for "RS256" in "id_token_signing_alg_values_supported"
    And the response body should list supported response types including "code"
    And the response body should list supported token endpoint auth methods

  Scenario: Retrieve valid JSON Web Key Set (JWKS)
    When a client sends a GET request to "/.well-known/jwks.json"
    Then the response status code should be 200
    And the response body should contain a "keys" array with at least one active key
    And each key in "keys" must contain "kty": "RSA", "alg": "RS256", "use": "sig", "n", "e", and "kid"
