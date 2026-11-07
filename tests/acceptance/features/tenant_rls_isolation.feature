Feature: Database Tenant Session Context & RLS Policies Migration

  Scenario: Tenant data isolation enforced by PostgreSQL RLS
    Given a user belonging to tenant "alpha-corp" and another user in "beta-corp"
    When a database transaction executes with "SET LOCAL app.current_tenant_id = 'alpha-corp'"
    And a query selects all users with "SELECT * FROM users"
    Then only records belonging to "alpha-corp" should be returned
    And zero records belonging to "beta-corp" should be exposed

  Scenario: Connection pool recycling without residual tenant state
    Given a connection used by tenant "alpha-corp" completes its transaction
    When another transaction executes on the same pooled connection for tenant "beta-corp"
    Then the session parameter should reflect only "beta-corp"
    And no data from "alpha-corp" should leak into the second execution

  Scenario: Fail-closed behavior when tenant context is omitted
    Given a connection where "app.current_tenant_id" was never set
    When an unauthenticated query executes "SELECT * FROM users"
    Then the database should return exactly 0 rows
