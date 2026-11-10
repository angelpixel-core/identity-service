Feature: Sliding Session Refresh Token Rotation with HttpOnly Cookies (US-09)
  As an authenticated user in the ecosystem
  I want my session to slide smoothly and renew short-lived access tokens via HttpOnly cookies
  So that tokens are safe from XSS exfiltration and token reuse is immediately detected and neutralized

  Background:
    Given the identity service is running and healthy
    And a registered public client "e-commerce-spa" with redirect URI "https://shop.local/callback"

  Scenario: Successful refresh token rotation with HttpOnly cookie
    Given an active session with valid refresh token cookie belonging to family "fam-100"
    When the client sends a POST request to "/oauth2/refresh"
    Then the response status code should be 200 OK
    And a new access_token should be returned in the response body
    And a new refresh_token cookie with "HttpOnly" and "SameSite=Strict" should be set
    And the previous refresh token should be marked as consumed

  Scenario: Detection of token reuse and complete family revocation
    Given a previously consumed refresh token from family "fam-100"
    When an attacker attempts to replay this consumed token at "/oauth2/refresh"
    Then the system should reject the request with HTTP 401 Unauthorized
    And all tokens associated with family "fam-100" should be immediately revoked
    And a security alert "REFRESH_TOKEN_REUSE_DETECTED" should be emitted

  Scenario: Successful token rotation via standard RFC 6749 request body
    Given an active session with valid refresh token "active_plain_rt_string_123" belonging to family "fam-200"
    When the client sends a POST request to "/oauth2/token" with grant_type "refresh_token" and refresh_token "active_plain_rt_string_123"
    Then the response status code should be 200 OK
    And the response body should contain "access_token" and "refresh_token"
    And a new refresh_token cookie should also be set

  Scenario: Explicit session revocation and cookie cleanup (Logout)
    Given an active session with valid refresh token cookie belonging to family "fam-300"
    When the client sends a POST request to "/oauth2/revoke"
    Then the response status code should be 200 OK
    And the refresh_token cookie should be cleared with Max-Age 0
    And the session should be marked as revoked

