# Client workspace and interactive onboarding

This release extends the existing portal rather than creating a separate client application. It supersedes the earlier static materials list and the earlier statement that the portal has no client uploads.

## Deployment

Deploy `main` to Vercel and reopen the CRM/PWA. Existing portal links keep their tokens, expiry and revocation behaviour; there is no production data migration. Existing Firebase Admin, Blob and push settings are reused. No additional API function, environment variable, composite index or Firestore rule publication is required when the repository's current deny-by-default rules are already installed. New collections are server-managed and are covered by that default denial. Earlier permissive catch-all rules must not be used.

Existing completed client onboarding is shown as previously completed. Clients are not asked to repeat it. The developer may explicitly start a new project onboarding form by loading the project onboarding panel and saving the service questions. This leaves the existing client checklist and completion flag untouched.

## Project setup

On the project page, open **Client onboarding → Load onboarding**. Before the client saves answers or files, the developer can select Website, Mini online shop, Business automation and/or Branding questions. Select only purchased services. Existing catalogue packages default to Website; unknown/custom services default to general business details until configured. Template changes lock once the client starts, avoiding lost answers or silently changed scope. All work and prices still require separate agreement.

## Client experience

The workspace has Overview, Onboarding, Project Progress, Files & Deliverables, Messages & Feedback, and Approvals & Requests. Progress/files/messages navigation is hidden when there is nothing meaningful available. Horizontal navigation scrolls on small phones. The first action card prioritises requested onboarding clarification, a published revision awaiting review, and unfinished onboarding, then explains the team's next step.

Onboarding guides clients through business details, service questions, materials, and review/submission. Known contact information is prefilled as a proposed answer; it never silently edits the canonical client record. Required fields and at least one email/phone are checked on the server. Clients can save progress, return using any still-valid share for the same project, preview all answers, and explicitly confirm before submitting. Drafts stay on the server, not in browser localStorage. An internet connection is needed to save. Unsaved answers are retained while switching workspace sections; the browser is warned before leaving. Reload saved progress explicitly replaces unsaved answers.

**States:** Not Started → In Progress → Submitted → Under Review → Approved. More Information Needed reopens editing and allows resubmission. Clients cannot set review or approval states. Only the developer approves. The currently assigned team can read submissions, start review, and request clarification. Final delivery status and client-care material checklists remain separate from project onboarding approval.

Submissions create immutable revisions and client activity entries, update `projects.onboardingStatus`, and notify the developer and assigned contact manager/delivery coordinator through existing bell/FCM mechanisms. A push failure does not lose the durable submission. Staff can retry the original action to retry the notice. Review messages are visible to clients in the workspace. Contact clients through the usual WhatsApp/email channel when needed; this release does not send automatic client email or add a live-chat service.

## Materials and storage

Clients can upload PNG, JPG, WebP and PDF materials: 2 MB per file, 10 files per project (up to 20 MB), and 10 upload reservations per project per South African day across all links. Upload progress distinguishes transmission from securing/finalising the file. Larger media should use the agreed project folder. SVG, HTML, archives and executable files are refused. MIME declarations and file signatures are checked; this is not a malware-scanning service. Do not request passwords or private customer datasets.

The existing AES-256-GCM Blob adapter stores encrypted bytes. Public JSON contains only safe metadata, never Blob URLs, paths or decryption keys. Downloads require the current live share or current staff assignment. Upload reservations and finalisation revalidate share/project/client access. Failed transfers preserve references for safe retry or later removal. Incomplete active uploads cannot be removed for two minutes. Failed deletion preserves the parent and file references for retry. File removal is available only while onboarding can be edited; old submission revisions retain filenames/answers, while downloads use current materials.

Portal uploads increase the existing Blob storage and transfer usage. Maximums are per project, not a promise of unlimited free-plan capacity. Monitor total Blob usage as projects accumulate. Deleting a client/project through the existing protected deletion flow cleans onboarding materials, revisions and operation records. Financial deletion safeguards remain unchanged. Old notifications, temporary rate counters and seven-day operation records are cleaned by bounded sweeps in the existing daily job.

## Security and reliability

Public operations derive the project/client from the hashed live share, ignoring submitted project/client IDs. Expired, revoked, deleting and mismatched-client links fail closed. Valid links are not reissued or invalidated. Every staff action rechecks canonical authentication and current project/client/lead assignment; approval/configuration additionally require developer privileges.

Optimistic versions prevent stale tabs overwriting newer work. Stable operation IDs make retrying the same save, submission or upload safe; changed payloads need a new attempt. Submission snapshots preserve history when information is requested and resubmitted. Read endpoints never expose internal health, private CRM notes, rates or file keys. The bearer link allows access to that project's client-provided information; a typed name is not identity verification. Staff must confirm identity and important corrections before approval or changing authoritative client data.

Existing project review decisions, verified request transitions, shared files, project folder links, link expiry, final-file access and revocation remain available. The workspace does not invent a client login, payment processing, paid messaging, or an unsupported partner role. Staff retain the CRM's existing developer/manager account roles.

## Production checks

1. Use a non-production/test project with a valid share and assigned manager.
2. Confirm only appropriate service questions appear. Save a draft and reopen the same private link.
3. Upload a small permitted file; verify the manager can download it and no plaintext storage URL appears in the portal response.
4. Submit and check project status, client activity, manager notification and developer notification.
5. As manager, request more information. Confirm the client sees it, can resubmit, and earlier answers remain in history.
6. As developer, approve. Confirm client editing closes and the existing project delivery status is unchanged.
7. Verify a published delivery review, change request and final file still work. Revoke a test share and confirm its onboarding reads/uploads/downloads stop.
8. Reassign the test manager and confirm the former manager can no longer load onboarding. Test real Android push separately.

Local tests use simulated identities/storage and exercise the actual handlers/components; they do not verify production credentials, deployed permissions, real Blob transfers or physical Android push delivery.
