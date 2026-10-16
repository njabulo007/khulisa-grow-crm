# Client portal: mobile access and project handover

## What changes

The client link uses wrapping mobile navigation, 44 px minimum control heights, readable form text, larger checkboxes, visible keyboard focus, a skip link and reduced-motion support. Files are not automatically downloaded. Legacy image previews load lazily. The portal checks for updates at most every ten minutes while visible and online; browser data-saving mode disables automatic checks. Manual Refresh remains available. Conversations and file metadata load when their sections open, without realtime listeners.

Client-facing forms say Getting Started and Send project details. Formal approvals remain separate from messages, and labels continue to use recorded project states. No timeline, support or completion guarantee is generated.

## Prepare the handover

On the CRM project, open Project collaboration → Handover → Prepare or update handover. The developer or assigned delivery coordinator can add:

- A secure website/product link.
- Practical instructions, including where to find any user guide in Files & Deliverables.
- Anything still to be handed over.
- Only the support included in this client's agreement, with an end date if agreed.

Keep passwords and access credentials out of these fields. Upload final documents through the existing private file workspace and publish them intentionally. The handover links to that authorised workspace, including existing categories and download/version controls. No public file URL or additional storage service is created.

Save as a draft first. Tick Share these handover details with the client and save to publish. Publishing requires instructions and does not close a project, complete milestones, create an approval or modify the client's agreement. Empty support fields are hidden. An optional end date is labelled as the agreed date, including when it is in the past; the portal does not imply support is still active.

Clients use Handover & Support to read published instructions, open their website, find final files, or ask a question/share satisfaction feedback in the existing project conversations. A completed project keeps those actions available while its private link remains valid. Remaining items stay visible; completion is not proof that every handover item is done.

## Schema and permissions

`projects.portalHandover` is an optional additive map: published, websiteUrl, instructions, outstanding, supportScope, supportUntil, version, publishedAt and updatedAt. Missing data defaults to an empty unpublished handover. Existing projects and milestone arrays are untouched. No production migration, new dependency, environment variable, route or database index is required.

The existing project-workspace API validates fields and links on the server, checks current project access, restricts writes to the developer/delivery coordinator, uses optimistic versions and existing operation IDs, and records activity/notifications only for changed details. Public workspace reads return an empty handover for drafts. Revoked/expired links continue to fail closed. Existing deny-by-default Firestore rules remain required.

## Rollback

Unpublish a handover to remove its instructions from future client reads. Previously viewed information cannot be recalled. To roll back the release, deploy the previous commit; the optional map is ignored by the older app and existing records remain usable. No record deletion or data conversion is needed. This work does not migrate legacy public files or change existing share-link expiry.

## Verification

API tests cover draft privacy, publication, unpublishing, access control, stale versions, unchanged saves, unsafe links, dates, and preservation of milestone/project state. Browser checks use actual components and handlers with simulated Firestore/Auth/storage. They do not replace physical-device testing or certify complete WCAG compliance. Check the deployed portal on Android with TalkBack, file selection and slow/mobile data as a final production check.

Local verification passed: 185 API tests and 86 frontend tests, application TypeScript checks, lint with no errors, and the production build. Browser journeys passed at 320, 360, 390, 768 and 1280 px, including published/draft handover, file and conversation workflows, minimum button heights, horizontal overflow, keyboard skip navigation and revoked access. Axe checks of all seven client views at each width found no WCAG A/AA violations under the configured WCAG 2.0–2.2 rules. This is automated evidence, not a full accessibility certification.
