# Client success and owner work queue

## Use the workflows

Open **Client Success** in the sidebar for the follow-up queue and requests. Each client page also has **Client check-in**, **Client activity**, and **Client requests**.

- Managers schedule their own next contact date, add formatted notes, and flag **Awaiting client response**. Queue filters cover Today, Overdue, Awaiting response, Upcoming, and All. Owners see the team's schedules; managers see their personal schedules for clients they can currently access.
- In **Client activity**, record a call, WhatsApp message, email, meeting, or note. An optional next date atomically schedules another check-in with the recorded outcome. Leaving it empty stops that manager's check-in reminder. Repeat contacts are unlimited and remain in client history. Payment reminders are separate and remain unchanged.
- Submit a website change, issue, or new requirement with a title, formatted details, and Low/Normal/High/Urgent priority. Attach up to three PNG/JPG/WebP/PDF/text files, each up to 2 MB. The request is saved before uploads; if a file fails, open the saved request to retry or remove the incomplete entry. An interrupted upload may need a minute before removal/retry.
- The owner sees all requests in **My work queue**, with urgent items first among loaded records. Open **Update work progress** and choose Received, In Progress, Ready for Review, or Completed. Add a formatted update for the manager. Progress updates also produce dated entries in client activity.
- Managers see their submitted requests in the global queue; a client's request panel shows team requests for that accessible client. Managers can change their own open-request attachments, and the owner controls progress. Completed requests remain available as history. The owner can remove completed-request attachments to reclaim storage.
- New requests notify owners; progress updates notify the submitter while they retain client access. Due/overdue check-ins generate a daily bell/push reminder. Notification links open the relevant client section. These are internal reminders; the CRM does not automatically contact clients.

## Deployment

Let Vercel deploy `main`, then reopen/refresh the PWA. No new API route, environment variable, composite index, Firestore rule change, or data migration is required. This reuses the existing Firebase Admin connection, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, and the existing `0 7 * * *` cron (about 09:00 Africa/Johannesburg).

The current invite-only `firestore.rules` must already be published, including its deny-by-default catch-all. New `client_follow_ups` and `client_requests` collections are server-only. Server checks use current lead/project assignments and trusted identity aliases; reassigned clients disappear from manager queues and stop generating their reminders.

## Storage and usage

Attachments are encrypted with AES-256-GCM before going into the existing public Blob store. Random paths reveal no client filenames; keys stay in server-only Firestore records and are excluded from API responses. Authorized downloads check current client access and decrypt on the server. These internal attachments are separate from public client-portal files.

Queues load in pages of 50 and refresh on demand. Counts and filters apply to loaded records; **Load more** includes older pages. No new realtime listener is added. File limits bound individual uploads, but retained files still consume Blob storage and downloads consume transfer quota. Delete unused attachments as appropriate; client deletion also removes its schedules, requests, files, and linked notifications. Failed cleanup preserves references for retry, and active upload leases prevent deletion racing an upload.

## Validation

Automated tests cover signed API calls, current assignment checks, owner-only progress changes, duplicate request/contact retries, optional repeat dates, daily reminders through the existing protected cron, pagination, attachment limits, encrypted round-trip/tampering, and retryable deletion. Browser checks exercise manager-to-owner workflows on desktop and mobile with simulated accounts/storage. Production Firebase permissions, Vercel Blob access, and push delivery must be tested after deployment; this environment has no live owner session or production secrets.
