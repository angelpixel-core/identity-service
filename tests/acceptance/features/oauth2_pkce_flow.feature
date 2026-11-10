Feature: OAuth2 Authorization Code Flow with PKCE
  As a public or confidential client application in the ecosystem
  I want to authorize users via Authorization Code Flow protected with PKCE (RFC 7636)
  So that users can grant access without exposing credentials and tokens cannot be intercepted

  Scenario: Successful authorization code generation with PKCE
    Given a registered public client "e-commerce-spa" with redirect URI "https://shop.local/callback"
    When the client requests authorization with response_type "code", redirect_uri "https://shop.local/callback", code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", and code_challenge_method "S256"
    Then the system should issue an authorization code
    And redirect to "https://shop.local/callback" with parameter "code"

  Scenario: Successful token exchange with valid code_verifier
    Given an issued authorization code for client "e-commerce-spa" with code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" and redirect_uri "https://shop.local/callback"
    When the client sends a POST request to "/oauth2/token" with grant_type "authorization_code", code_verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", and redirect_uri "https://shop.local/callback"
    Then the response status code should be 200 OK
    And the response should include "access_token" of type "Bearer"
    And the response should include a valid "id_token" signed with RS256

  Scenario: Reject token exchange with invalid code_verifier
    Given an issued authorization code with code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    When the client presents an incorrect code_verifier "wrong_verifier_string_at_least_43_characters_long_for_testing"
    Then the system should reject the exchange with HTTP 400 Bad Request
    And the response body error should be "invalid_grant"

  Scenario: Reject token exchange when authorization code is reused
    Given an already consumed authorization code
    When the client attempts to exchange the consumed code again
    Then the system should reject the exchange with HTTP 400 Bad Request
    And the response body error should be "invalid_grant"

  Scenario: Reject authorization request for public client without code_challenge
    Given a registered public client "e-commerce-spa"
    When the client requests authorization without code_challenge
    Then the system should reject the request with HTTP 400 Bad Request
    And the response body error should be "invalid_request"

