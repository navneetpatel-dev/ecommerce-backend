Review the **entire backend codebase** and refactor it for maximum **modularity, reusability, maintainability, consistency, and DRY principles**, without changing existing business behavior or breaking any working functionality.

Follow the existing **Layered Modular Monolith** architecture and coding conventions.

### Requirements

1. **Eliminate duplication**

   * Find duplicated business logic, validations, queries, transformations, constants, helper functions, error handling, response handling, and third-party integration logic.
   * Extract genuinely reusable logic into the appropriate shared/core/module utility instead of maintaining multiple copies.
   * Do not over-abstract code that is only coincidentally similar.

2. **Proper separation of responsibilities**

   * Controllers: HTTP/request/response handling only.
   * Services: business logic and orchestration.
   * Repositories: database/data-access logic.
   * DTOs: request validation and types.
   * Middleware: request-level validation/auth/authorization concerns.
   * Core: genuinely cross-module reusable infrastructure and abstractions.
   * Config: centralized infrastructure/client configuration.
   * Jobs: background processing only.
   * Keep business/domain logic out of controllers, routes, models, and generic utilities.

3. **Reuse existing abstractions**

   * Before creating a new helper, service, repository method, constant, validator, error, response formatter, pagination implementation, database utility, or integration wrapper, search the entire codebase for an existing equivalent.
   * Extend/reuse existing abstractions where appropriate instead of creating parallel implementations.
   * Maintain a single source of truth for shared behavior.

4. **Module boundaries**

   * Keep domain-specific logic inside the appropriate `src/modules/*` module.
   * Prevent unnecessary cross-module coupling.
   * Shared functionality should move to `src/core/*` only when it is genuinely cross-domain.
   * Do not move domain logic into `core` just to make files smaller.

5. **File and folder structure**

   * Each file should have one clear responsibility.
   * Split oversized files when responsibilities are mixed.
   * Consolidate fragmented files when multiple files contain tightly related trivial logic.
   * Keep routes, controllers, services, DTOs, repositories, and supporting utilities consistently structured across modules.
   * Follow the existing project naming and organization patterns.

6. **Database/repository layer**

   * Remove repeated Sequelize queries and data-access patterns.
   * Reuse `BaseRepository` and existing repository abstractions where appropriate.
   * Keep database access out of controllers.
   * Avoid unnecessary repository methods when an existing reusable method already provides the required behavior.

7. **Constants, types, validation & errors**

   * Remove duplicated literals and magic values.
   * Centralize genuinely shared constants/enums.
   * Reuse existing TypeScript types and Zod schemas where appropriate.
   * Standardize error handling using the existing error hierarchy.
   * Avoid duplicate validation implementations.

8. **Third-party integrations**

   * Centralize reusable integrations such as Redis, S3, email, Razorpay, queues, etc.
   * Do not initialize or configure the same client/integration in multiple places.
   * Keep provider-specific implementation details isolated behind reusable abstractions where beneficial.

9. **Code quality**

   * Remove dead code, unreachable code, unused imports, obsolete helpers, redundant conditions, unnecessary wrappers, and obsolete abstractions.
   * Simplify unnecessarily complex implementations.
   * Preserve strong TypeScript typing; avoid introducing `any`.
   * Follow the existing formatting, naming, async/error-handling, and coding patterns.

10. **Do not over-engineer**

* Do not introduce patterns, abstractions, interfaces, factories, base classes, or additional layers without a real reuse/maintenance benefit.
* Prefer simple, readable code over excessive abstraction.

### Critical rule

**Do not change business behavior, API contracts, database behavior, authorization behavior, or existing features unless a change is strictly required to fix a clear architectural/code-quality issue.**

Before modifying anything, inspect the **entire backend** and understand existing patterns and dependencies. Refactor based on the actual codebase rather than assumptions.

After refactoring, verify:

* No duplicated logic remains where reuse is appropriate.
* No unnecessary abstractions were introduced.
* Module boundaries are clean.
* Responsibilities are correctly separated.
* Existing shared utilities/abstractions are actually reused.
* Imports and dependencies remain clean.
* TypeScript/build/lint/tests pass.
* Existing functionality and API contracts remain intact.

Make the changes directly across the backend and provide a concise summary of:
**(1) duplicated logic removed, (2) abstractions reused/created, (3) files reorganized, (4) major architectural improvements, and (5) validation/tests performed.**
