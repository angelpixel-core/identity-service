Feature: Infrastructure Health and Readiness Probes
  As a Kubernetes cluster orchestrator and site reliability engineer
  I want isolated liveness and readiness probe endpoints
  So that pods failing internal loops are restarted, unready pods are taken out of traffic routing, and diagnostic states can be inspected without causing service disruptions.

  Scenario: Liveness probe succeeds while application loop is healthy
    Given the identity service process is running
    When a probe request is made to "/health/live"
    Then the response status code should be 200
    And the response body should contain status "UP"
    And the response body should include liveness check "OK"

  Scenario: Readiness probe returns 200 when all critical dependencies are healthy
    Given the PostgreSQL database connection is operational
    And the active JWKS key pair is loaded in KeyVault
    When a probe request is made to "/health/ready"
    Then the response status code should be 200
    And the response body should contain status "UP"
    And the database check should be "OK"
    And the keyvault check should be "OK"

  Scenario: Readiness probe returns 503 when PostgreSQL dependency is unavailable
    Given the PostgreSQL database connection is down or unreachable
    When a probe request is made to "/health/ready"
    Then the response status code should be 503
    And the response body should contain status "DOWN"
    And the database check should be "DOWN"

  Scenario: Readiness probe fails fast on dependency timeout
    Given a critical dependency takes longer than 1500 milliseconds to respond
    When a probe request is made to "/health/ready"
    Then the probe should abort within 1500 milliseconds
    And the response status code should be 503
    And the response body should contain status "DOWN"

  Scenario: Aggregated health diagnostic endpoint exposes detailed dependency report
    Given the identity service is operational
    When an operator sends a GET request to "/health"
    Then the response status code should be 200
    And the response body should contain overall status "UP"
    And the response body should include individual latencies for each probe
