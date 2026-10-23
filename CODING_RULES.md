# Mandatory Engineering Rules — All Human and AI Coders

**Applies to:** OpenCode, ChatGPT, other AI agents and human developers.
**Priority:** Required for every code change. Read with PROJECT_PLAN.md before editing.

## Fundamental principle
Maintain **one cohesive, working application**. Do not overengineer, duplicate functionality, leave dead code, or rewrite working code unnecessarily. Every update must integrate with the existing implementation and preserve confirmed behavior.

## Before making changes
1. Read relevant existing files, tests, database migrations and PROJECT_PLAN.md. Never assume a component is missing without checking.
2. Understand dependencies and existing user flows before editing. Make a small explicit change plan.
3. Prefer modifying/reusing existing modules to building parallel systems or replacing the entire feature.
4. Establish baseline test/build status; if something already fails, document it.

## While editing
1. **Minimal, targeted edits.** Do not generate a second app, auth system, API, booking calendar, database layer or styling framework when one already exists.
2. Keep naming, architecture, contracts, database migrations and UI consistent with the existing code.
3. Never silently delete functional code, features or data. Remove obsolete code only after checking imports, routes, migrations, usage and behavior, and replacing required behavior where applicable.
4. **No dead code:** remove unused imports, variables, components, routes, duplicate styles, stale toggles, unreachable branches and obsolete assets in the scope of the change. Do not leave commented-out implementations as substitutes.
5. Avoid adding dependencies without justification; prefer existing tools. Keep changes readable, small and maintainable.
6. **Database changes:** use additive, reviewable migrations; never drop/overwrite production tables or real data casually. Plan rollback and data migration explicitly.
7. Security is non-negotiable: never expose secrets or customer information, weaken auth/RLS/server checks, or bypass booking/payment validations.
8. Do not invent fake real-world school claims, business data, reviews or certifications on production-facing screens.

## Definition of done for EVERY change
- New feature works **end-to-end** with previously working features.
- Run formatting/linting, TypeScript checks, relevant automated tests and production build; add regression tests for changed behavior.
- Verify related routes and flows manually where automation is missing (especially mobile, authentication, booking, rescheduling and payments).
- Confirm no unused/dead code, duplicate implementations, secrets, PII, unexpected files, or unreviewed dependencies.
- If tests cannot run, **explicitly report the limitation** and do not claim the change is verified.
- Update PROJECT_PLAN.md checklist/status and relevant documentation; never mark untested features complete.
- Review diffs; commit scoped changes to a feature branch, push only after local validation and review.

## Prohibited practices
- Rewriting whole files/projects to make a tiny update without necessity.
- Adding "temporary" insecure production paths, hardcoded passwords or bypassing authorization.
- Abandoning old working features when adding new ones.
- Leaving TODO-only placeholders or nonfunctional buttons while claiming a feature works.
- Shipping knowingly broken builds, unresolved runtime errors or orphaned/dormant code.
- Deleting migrations or modifying historical applied migrations instead of writing a new migration.

## Required change report (every coding task)
State:
1. What changed and why.
2. Which existing functions/features were preserved.
3. Which obsolete files/code were safely removed.
4. Tests/build actually run and results.
5. Known limitations and next steps.

**Rule:** If a proposed change could break functioning code, first protect it with tests or a rollback strategy. Stability, privacy and working software take precedence over speed or visual polish.
