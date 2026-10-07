# CRM consistency and client portal update

## Apply the update

1. Let the pushed `main` commit deploy on Vercel and reopen the CRM as the owner.
2. On **Clients**, click **Repair assignments** once. This adds missing project references to existing client records; it does not delete records or change assignees.
3. Publish this repository's `firestore.rules` in Firebase Console → Firestore Database → Rules. Repair existing assignments before publishing to preserve access to clients whose projects were created manually.
4. In **Settings → Team & Access**, archive agents you no longer want in rankings or new assignment menus. Existing assignments and financial history stay intact. Archiving is roster management; it does not disable Firebase sign-in. Reassign their leads and projects if their record access should end.
5. Sign in as an agent and confirm that only their assigned leads/projects and linked clients appear. The owner should see all records, including those created by other agents.

No new Vercel routes or environment variables are required. Blob configuration and push notification delivery are unchanged.

## What changed

- Dashboard and reports share one ranking calculation: won leads, then paid revenue. Both Firebase UIDs and approved legacy IDs match assignments. Paid invoices are attributed once, using the project assignee before the lead assignee.
- Inactive profiles stay inactive during synchronization; canonical profiles replace duplicate and obsolete browser roster entries. Archived users leave ranking and assignment menus.
- Authentication lookup failures produce errors rather than silently loading agent-scoped owner data. Leads/clients reload on local changes, account changes, and returning to the app.
- Agent client queries use assigned leads/projects, rather than the record creator. Rules check the current linked project assignee using a stored project reference; an old creator or old cached grant cannot retain access after reassignment/deletion.
- New owner project assignments save project/client access together. Existing assignments have a one-time repair control. Project deletion keeps client access through remaining projects.
- Project detail, agent progress cards, and the portal count recorded milestones, including custom milestones, rather than matching package marketing copy.
- Shared CRM cards, KPIs, spacing, and page headings use a quieter navy/gold design. Client lists include relationship totals and visible refresh controls.
- The client portal removes repeated progress cards, package advertising/prices, and private CRM notes. It adds manual refresh, file search, milestone filters, a project contact link where available, and separately published client updates. Link expiry/revocation and existing project closure behavior remain in effect.

## Verification limits

Automated service tests cover owner/agent query scope, rankings, duplicate profiles, atomic assignment updates, and deletion cleanup. Browser checks use simulated records and owner/agent sessions on desktop and mobile. They do not prove that a specific production account's missing client is repaired. Production access and the published Firestore rules must be checked after rollout; this workspace does not have a live owner session or Firebase Admin credentials.
