# Client workspace implementation

## Existing system

React/TypeScript/Vite PWA, Firebase Auth and Firestore, Vercel endpoints, encrypted request attachments in Vercel Blob, and existing bell/FCM notifications. `/p/:token` resolves hashed, expiring/revocable `project_shares` through `/api/project-shares/resolve`. Projects, clients, milestones, care checklists, portal responses and verification already exist. Staff use canonical Firebase identity and role/assignment checks. Browser clients cannot directly write the new server-managed data.

## Controlled phases

1. Add a project-scoped onboarding record and immutable submission revisions. Revalidate the share, project and client on every public operation. Use optimistic versions, stable mutation IDs and bounded daily write/upload budgets. Keep canonical client contact data untouched. Share only onboarding answers, safe file metadata and client-visible review comments with clients.
2. Reuse encrypted Blob storage for small allow-listed materials. Bound total files, per-file size and daily upload reservations. Keep keys private, validate file signatures, reserve/finalise uploads, and preserve deletion references on failure. Add authorised team review, explicit internal review states, activity records, existing notifications, and resubmission. No automatic changes to prices, financial records or delivery commitments.
3. Add mobile workspace navigation, a prioritised action card and a guided business/service/materials/review form. Service templates are configurable per project by the developer; default existing packages to website questions, without inventing unpurchased services. Preserve working reviews, requests, milestones, contacts, final files and link expiry behaviour.

## Validation and rollout

Test link expiry/revocation, assignment changes, draft version conflicts, retries, submission validation, revision history, internal-state restrictions, template selection, private-field exclusion, upload bounds/signatures/failures and deletion cleanup. Run API/frontend suites, typecheck, lint, production build and desktop/mobile browser checks. Deploy through existing routes without new environment variables or composite indexes. Existing Blob and notification configuration is reused. No production migrations, destructive operations or token invalidation are required. Document free-plan storage limits and manual production checks.
