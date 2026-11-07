Feature: Dynamic Client Registry and Origin Validation

  Scenario: Successful validation of a registered public SPA client
    Given a registered client "portal-web" of type "public" with allowed origin "https://portal.angelsolutions.io"
    When the client initiates an authorization request from origin "https://portal.angelsolutions.io"
    Then the client authorization middleware should accept the request
    And propagate the client context downstream

  Scenario: Rejection of unregistered origin for a valid client
    Given a registered client "portal-web" with allowed origin "https://portal.angelsolutions.io"
    When an unauthorized site "https://malicious-site.com" attempts to make a request with client_id "portal-web"
    Then the system should reject the request with HTTP 403 Forbidden
    And return an error code "unauthorized_client_origin"

  Scenario: Rejection of inactive client application
    Given a client "legacy-app" marked as inactive
    When the client attempts to authenticate
    Then the system should reject the request with HTTP 401 Unauthorized
    And return an error code "client_deactivated"

