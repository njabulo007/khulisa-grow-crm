# Client success and owner work queue

## Use the workflows

Open **Client Success** in the sidebar for the follow-up queue and requests. Each client page also has **Client check-in**, **Client activity**, and **Client requests**.

- Managers schedule their own next contact date, add formatted notes, and flag **Awaiting client response**. Queue filters cover Today, Overdue, Awaiting response, Upcoming, and All. Owners see the team's schedules; managers see their personal schedules for clients they can currently access.
- In **Client activity**, record a call, WhatsApp message, email, meeting, or note. An optional next date atomically schedules another check-in with the recorded outcome. Leaving it empty stops that manager's check-in reminder. Repeat contacts are unlimited and remain in client history. Payment reminders are separate and remain unchanged.
- Submit a website change, issue, or new requirement with a title, formatted details, and Low/Normal/High/Urgent priority. Attach up to three PNG/JPG/WebP/PDF/text files, each up to 2 MB. The request is saved before uploads; if a file fails, open the saved request to retry or remove the incomplete entry. An interrupted upload may need a minute before removal/retry.
- The owner sees all requests in **My work queue**, with urgent items first among loaded records. Open **Update work progress** and choose Received, In Progress, Ready for Review, or Completed. Add a formatted update for the manager. Progress updates also produce dated entries in client activity.
- Managers see their submitted requests in the global queue; a client's request panel shows team requests for that accessible client. Managers can change their own open-request attachments, and the owner controls progress. Completed requests remain available as history. The owner can remove completed-request attachments to reclaim storage.
- New requests notify owners; progress updates notify the submitter while they retain client access. Due/overdue check-ins generate a daily bell/push reminder. Notification links open the relevant client section. These are internal reminders; the CRM does not automatically contact clients.

## Client health and onboarding

Open a client to assess **Healthy**, **Needs Attention**, or **At Risk**, with a formatted reason and last-contact date. Clients remain **Not assessed** until reviewed. Calls, emails, WhatsApp messages, and meetings recorded through Client activity update a shared last-contact timestamp; notes alone do not. Historic contacts can be entered manually.

Managers can **Save and escalate to owner** for concerns. This saves an open escalation, adds client history, and sends the owner a bell/push notification linking to Client health. Only the owner can resolve it, with a resolution note. Health status and escalation resolution are separate: resolving a concern does not silently change its health rating. Client Success shows assigned clients for managers and all clients for owners, with filters for concerns, risk, escalations, unassessed clients, and incomplete onboarding.

The onboarding checklist tracks **Logo and brand assets**, **Website content**, **Access credentials**, **Signed contract**, and **Client requirements**. Each item has a status (Outstanding, Requested, Received, or Not Required) and notes. All five must be Received or Not Required for onboarding to be complete. Saving the checklist also keeps the existing client completion and signed-contract flags consistent. Old completed clients retain that status and show a reminder to review their detailed checklist; no bulk migration is performed. Client forms now direct users to the checklist rather than the old completion checkbox. Access notes should describe required accounts and invitations, never contain passwords or secret keys.

Care records live in the server-only `client_care` collection and are deleted with their client. Updates recheck actual client assignments, protect against conflicting edits, and deduplicate retry requests. The overview fetches summaries for at most 50 clients per page on demand, after loading the existing accessible-client list; it adds no realtime listener. No new variables, routes, indexes, or rules are needed when the current deny-by-default rules are already published. Production push delivery still needs a live test.

## Feedback, growth opportunities, and communication drafts

Each client now has **Feedback and approvals**. Managers record the deliverable or request, deliverable version, Approved / Rejected / Changes Requested decision, client approver/contact, decision date, and formatted supporting feedback. **Record next revision** keeps earlier records in immutable server-only revision documents. Revision history loads on demand in pages of 50, and every change is also recorded in client activity. These are manually recorded client decisions; recording feedback does not automatically change a project or request status. Owners receive a notification linking to the feedback section.

**Growth opportunities** tracks additional services, renewals, and referrals against the existing client. Managers propose a title, need, suggested scope, optional price in rand, and optional target/renewal date. Suggested pricing is clearly separate from owner-approved pricing. Only the owner can approve final scope and price, request changes with a note, or decline. Approved/declined proposals must be reopened by the owner requesting changes before the proposer can revise them. Proposal and owner-review revisions remain in history. Owner review notifies the original proposer only while they still have current client access. Client Success includes the owner's proposal review queue and each manager's own proposals. Approval records the commercial decision; it does not create an invoice or project automatically.

**Communication templates** prepares editable WhatsApp/email drafts for check-ins, missing materials, progress updates, and payment reminders. Drafts use the client contact and manager name. Missing-material drafts use checklist item names, never access notes or internal health reasons. Progress drafts require the manager to replace placeholders before copying/opening them. Payment drafts require an unpaid sent invoice and use the remaining balance, due date, and payment reference; paid/draft invoices are excluded. Managers review and edit the draft, then copy it or open WhatsApp/their email app. Nothing is sent automatically. Unsaved draft edits last only while the client page remains open.

Records and histories are server-only in `client_feedback`, `client_feedback_revisions`, `client_opportunities`, and `client_opportunity_revisions`. Current lead/project assignments are rechecked on reads and writes. Transactions preserve history and protect against conflicting edits and repeated network requests. Client deletion removes these records, histories, and linked notifications. Lists and histories use ascending document-ID pagination to avoid the missing-index issue. No new API route, dependency, environment variable, index, or rules change is needed with the existing deny-by-default rules. New notifications and revisions are created only when users save changes; templates add no server writes or realtime listeners. Test actual device push and external draft opening after deployment.

## Deployment

Let Vercel deploy `main`, then reopen/refresh the PWA. No new API route, environment variable, composite index, Firestore rule change, or data migration is required. This reuses the existing Firebase Admin connection, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, and the existing `0 7 * * *` cron (about 09:00 Africa/Johannesburg).

The current invite-only `firestore.rules` must already be published, including its deny-by-default catch-all. The client-success collections, including care, feedback, opportunities, and their histories, are server-only. Server checks use current lead/project assignments and trusted identity aliases; reassigned clients disappear from manager queues and stop generating their reminders.

## Storage and usage

Attachments are encrypted with AES-256-GCM before going into the existing public Blob store. Random paths reveal no client filenames; keys stay in server-only Firestore records and are excluded from API responses. Authorized downloads check current client access and decrypt on the server. These internal attachments are separate from public client-portal files.

Queues load in pages of 50 and refresh on demand. Counts and filters apply to loaded records; **Load more** includes additional pages. All queues paginate in ascending document-ID order using Firestore's built-in indexes, then sort loaded records for display. Descending document-ID queries require an additional index even for unfiltered owner queues. No new realtime listener is added. File limits bound individual uploads, but retained files still consume Blob storage and downloads consume transfer quota. Delete unused attachments as appropriate; client deletion also removes its schedules, requests, files, and linked notifications. Failed cleanup preserves references for retry, and active upload leases prevent deletion racing an upload.

## Validation

Automated tests cover signed API calls, current assignment checks, owner-only progress changes, duplicate request/contact retries, optional repeat dates, daily reminders through the existing protected cron, pagination, attachment limits, encrypted round-trip/tampering, and retryable deletion. Browser checks exercise manager-to-owner workflows on desktop and mobile with simulated accounts/storage. Production Firebase permissions, Vercel Blob access, and push delivery must be tested after deployment; this environment has no live owner session or production secrets.


For the connected daily workflow, client tabs, portal verification and deployment steps, see [Workflow rollout](WORKFLOW-ROLLOUT.md).
