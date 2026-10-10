# Workflow and portal rollout

This release connects acquisition, client care, delivery, review, billing and growth without introducing new services, environment variables or API routes.

## Required deployment steps

1. Publish the repository's complete `firestore.rules` in Firebase Console → Firestore Database → Rules. Do this before assigning a dedicated contact manager or using Disable access. These rules protect the new manager assignment, deny disabled accounts, let dedicated managers read their clients' projects, and make standalone project creation owner-only. Keep the whole file; do not combine it with the earlier permissive catch-all rules.
2. Wait for the production Vercel deployment from `main`, then close/reopen the PWA. Existing Firebase Admin, Blob and `CRON_SECRET` settings are reused. No new composite indexes are needed.
3. If Firebase Functions from `functions/index.js` are still deployed, update them with the included compatibility fixes, or disable the obsolete automatic share-revocation trigger and legacy financial reconciliation triggers when using the Vercel financial path. An old `revokeProjectSharesWhenProjectClosed` deployment still revokes shares at delivery. An old financial trigger can rewrite commission terms. The cloud workspace cannot check or change those production deployments. Spark-only operation uses Vercel for the new financial path and reminders.
4. Verify one manager's client/project access, a partial payment, a payout, an owner-approved opportunity invoice, and one client portal response. Do not use made-up payments on a real invoice; use a test record or a genuine receipt.

Publishing Firestore rules and verifying real Android/FCM delivery remain production checks. Local tests use simulated identity/data and exercise the actual handlers/components; they do not prove production credentials or rules are installed.

## Daily workflow

- Dashboard and Client Success begin with Today's work: lead/client/payment follow-ups, waiting responses, urgent requests, onboarding/health concerns and scope decisions. Counts describe loaded records, not a complete database-wide aggregate. Global payment follow-ups are owner-only and bounded to 100 scheduled records. Other server queues start at 50 and have dedicated paginated views.
- Clients use Overview, Conversations, Onboarding, Delivery, Approvals, Growth and Billing tabs. Tabs load on first visit and keep drafts when switching tabs. Notifications select the correct tab and anchor.
- Owners can assign a dedicated contact manager when creating/editing a client. Existing lead/project-derived access still works. A contact manager can read the client's project details, but cannot edit another delivery coordinator's milestones or technical status.
- Leads have qualification, next action and lost reason fields, a similar-contact warning, and a conversion handoff summary. The warning respects the user's visible records. Existing catalogue-based lead conversion is retained; standalone project creation requires the owner.
- Projects can identify a separate build owner. Requests have an optional project and requested date. Requests, pricing and delivery remain separate: a request does not silently approve new scope, and delivery does not imply payment.

## Finance

- Invoice numbering uses a server transaction and permanent year counter. Initialisation reads the maximum suffix, not the count. Deleting invoices cannot reuse reserved numbers. Gaps from cancelled drafts are expected.
- Payment entry uses a form with amount/date/method/receipt reference. The authenticated owner-only Vercel transaction checks the current balance, records the payment, updates invoice status and reconciles commission eligibility together. Stable retries and duplicate receipt checks avoid recording the same receipt after a lost response or page reload.
- Rates are stored centrally with an explicit percentage unit; legacy decimal rates are interpreted compatibly. New 0.5% and 1% rates are not interpreted as 50% or 100%.
- Opening pages no longer triggers historical commission repair. Settings → Maintenance offers an explicit repair for unpaid commissions. Settled payouts are preserved by repair, Vercel payment reconciliation and the updated legacy function source.
- Payout requires a fully paid invoice and an earned commission, records the transfer reference, date and owner, and cannot be repeated with a different reference. Corrections to settled payouts should be separate authorised adjustments, not edits to the settled amount.
- Owner revenue charts use payments by their South African receipt month, including partial payments. Reports provide cash date filters and consistently calculate lead win rate as won / (won + lost). Other operational measures remain all-time and are labelled accordingly.
- Draft invoices are excluded from client billed/outstanding totals. Approved positive-price growth proposals can create one linked draft invoice using the approved scope/price, with retry protection. Zero-price proposals do not create a bill. Custom referral/renewal commission terms still need an explicit policy; no commission is invented for a custom service without an agreed package.

## Team and settings

After a growth proposal is invoiced, its approved scope and price are locked. Changes require a new proposal so the approval record stays consistent with the invoice.

Settings separates Personal, Team & Access, Commission Policy, Templates, Business & Billing, and Maintenance. Agents have personal appearance/password options and bell-menu push diagnostics.

Archive changes roster visibility only. Disable access denies the Firestore profile first, disables Firebase Auth and revokes refresh tokens. Restore access enables Auth before lifting the profile restriction. It cannot disable the current owner or another owner through this agent control. Previously displayed information cannot be erased remotely; subsequent protected operations are denied.

Shared templates support `{clientName}`, `{contactName}`, `{senderName}`, `{materials}`, `{invoiceNumber}`, `{outstanding}` and `{dueDate}`. Blank bodies retain the standard template. Unknown placeholders are shown as instructions and must be edited before sending. Drafts remain editable and are sent manually. They do not disclose health/private checklist notes. Banking details remain the previously verified Standard Bank details; this release does not invent or change payment instructions.

## Portal workflow

The portal shows missing-material labels and published review instructions while keeping private CRM notes, health reasons, commission data and credentials out of its payload.

1. Owner opens a project → Client review & responses, supplies a title/revision/instructions and optionally links a work request, then publishes.
2. Client uses the expiring portal link to respond to that exact revision, or submit a change request. Selecting a decision is explicit. Name/details are required; requests are limited to 10 responses per share per South African day.
3. Owner receives a notice and loads responses from the project. Responses are **pending verification**: a bearer link and typed name do not establish identity.
4. After verifying with the client, owner records the response. It appends immutable feedback history. Only the explicitly linked request transitions: approved → Completed; rejected/changes requested → In Progress. Project completion and new pricing are not automatic.
5. A verified new request enters the owner's work queue, linked to that client/project. Its scope, deadline and price still require owner agreement. The contact manager receives a verification notice.

Revoked, expired, deleted and cross-project links cannot submit responses. Old revisions cannot approve a new revision. Retries of an existing response do not create duplicates. Publishing a new revision supersedes the previous review; stale responses can be dismissed, not applied to a different revision.

Delivering a project now keeps read access to final files until the share expires or the owner revokes it. Delivered projects can receive a new change request but cannot receive decisions against an old review. Reopen the project before publishing another revision. Already expired/revoked links are not automatically reactivated; the owner can create a new share.

Materials still go through the agreed folder/contact; arbitrary public file uploads and password collection were deliberately not introduced. This avoids exposing a new storage abuse surface or increasing Blob usage without a defined client upload policy.

## Efficiency and maintenance

Core collection lists have a 15-second in-memory cache scoped to the Firebase UID, invalidated by mutations. Nothing is persisted as CRM data in localStorage. Global search refreshes after writes and rejects stale responses. This reduces repeated page/search reads while keeping role checks and Firestore rules authoritative.

The existing daily cron performs a bounded maintenance sweep: at most 100 notifications and 50 portal rate-limit records per run. Notifications older than 30 days and expired temporary rate limits are removed; financial records and decision histories are preserved. A large backlog is cleaned over multiple runs. The bell's existing subscription remains live, so retention reduces its history size rather than introducing an index-dependent query that could fail on existing deployments.

Deleting clients/projects cleans their portal responses and temporary rate-limit records through the existing deletion flow. Existing financial deletion protections are retained. No per-card live listeners, automatic paid messaging, public unlimited uploads or a second task collection were added.

## Verification

The automated suites cover transaction retries, numbering after deletion, partial/full payments, receipt duplication after reload, low percentage/legacy rates, payout references, settled commissions, role restrictions, direct manager access, portal scope/expiry/revocation, stale revisions, verification history, linked request transitions, delivered-project requests and bounded retention.

Browser checks use the actual React pages and handlers with simulated Auth/data. They cover desktop and 390px mobile client tabs, request project/deadline selection, payment form, portal publication/submission/verification, feedback history and Today's work. Existing care, checklist, growth and editable-draft workflows are also checked after navigation changes. Real Firebase rule publication, existing Function deployments, FCM delivery and external email/WhatsApp opening require production verification.
