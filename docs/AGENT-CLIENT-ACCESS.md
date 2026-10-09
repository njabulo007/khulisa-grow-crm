# Agent client access rollout

After Vercel deploys the change:

1. Sign in as the owner and open **Clients → Repair assignments**. This repairs server-verified project references on legacy clients without changing assignees or deleting records.
2. Open Firebase Console → Firestore Database → Rules. Replace the entire rules editor with the repository's `firestore.rules` and click **Publish**. A Vercel deployment does not publish Firebase rules.
3. Reopen the PWA, sign out and sign back in as the affected agent. Check Clients, a client detail page, Invoices, and CRM search. Agents should see clients linked to their assigned leads or projects; owners retain full access.

No new environment variables or indexes are introduced.

Client and invoice list rules now evaluate the queried document directly. Related-record queries use one known lead, client, project, or invoice per request, avoiding the rule document-access limit for mixed portfolios. Package normalization uses already-loaded assigned projects instead of fetching another agent's project. Client detail and invoice loading report failures with retry controls.

An installed PWA can open an uncached route offline using its precached app shell. This fallback does not grant database access or guarantee that uncached CRM records are available offline.

Validation: 76 frontend tests, 81 API tests, TypeScript, lint (existing warnings only), and the production build passed. Chromium verified an offline visit to uncached `/settings` returned the cached login screen without a service-worker `no-response` error. Service tests use mocked storage; production Firebase access remains to be checked after publishing. Firestore emulator execution was blocked because its artifact download returned HTTP 403 from the environment's network policy.
