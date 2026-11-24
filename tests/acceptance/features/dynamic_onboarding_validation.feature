Feature: Dynamic Onboarding and Strict Phone/Method Validation (US-32)

  Scenario: tusherramientas-a requires valid E.164 phone on registration
    Given tenant "tusherramientas-a" has requiredAttributes.phone = true
    When registering without phone or with invalid format
    Then the response status is 400 with error "validation_error"
    When registering with "+5491112345678"
    Then the user is created with status 201 and phone "+5491112345678"

  Scenario: academia-beisbol allows registration without phone
    Given tenant "academia-beisbol" has requiredAttributes.phone = false
    When registering with email and password only
    Then the user is created with status 201

  Scenario: Password method disabled returns 403 auth_method_disabled_for_tenant
    Given tenant "sso-only-corp" has allowedAuthMethods.password = false
    When attempting password registration or login
    Then the response status is 403 with error "auth_method_disabled_for_tenant"
