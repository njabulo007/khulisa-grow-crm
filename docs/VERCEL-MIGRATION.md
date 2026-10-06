# Deploy owner recovery and lead conversion to Vercel

Firebase continues to store accounts and CRM data. Vercel now runs these authenticated operations:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/ensure-role` | Recover the canonical profile and Firebase role claims during sign-in |
| `POST /api/auth/set-role` | Let an owner change another user's role |
| `POST /api/leads/convert` | Atomically create/link a client, optionally create a project, and mark the lead Won |
| `POST /api/records/delete` | Delete a lead/client/project/invoice and its owned notes, notifications, portal files, and other confirmed dependants |

These operations no longer call Firebase Functions. The existing portal and Blob endpoints remain in place, and owner authorization also checks the canonical profile. Every protected endpoint verifies the Firebase bearer token. The recovery UID list is server configuration; supplying a role or email in a browser request cannot grant ownership.

## Deletion cleanup update

Deploy the updated code and republish `firestore.rules` together. No additional environment variables are required. Parent records must now be deleted through the authenticated cleanup endpoint; older cached frontends attempting a direct parent delete will receive permission denied under the new rules.

| Delete action | Cleanup and protections |
| --- | --- |
| Lead | Deletes the lead, its activities and reminders; keeps its converted client/projects and removes the client's obsolete lead link. |
| Client | Blocks while projects or invoices remain linked. Once resolved, deletes the client, its activities, notifications, portal shares/files, and removes retained leads' client links. |
| Project | Blocks while invoices or commissions remain linked. Deletes the project, its activities, notifications, portal shares, Firebase Storage files and Vercel Blob files referenced by those shares. Keeps the client and lead. |
| Invoice | Protects linked payments/commissions unless the owner explicitly selects the existing force-delete checkbox. Deletes the confirmed dependants, invoice activities, reminders, and invoice. |
| Portal link revocation | Immediately disables the link, removes its files, and removes the share document when cleanup succeeds. Failed file paths remain on a revoked share with a Retry File Cleanup button. |

Deleting payments, commissions, notes and dismissed notifications already performs a Firestore document deletion. Removing a user from the local authentication cache during sign-in is not an account deletion; this update does not delete Firebase Auth accounts.

Cleanup queries use record IDs rather than loading entire collections and split large histories into bounded batches. The parent is marked `_deleting` during cleanup to prevent new linked writes, and is removed last. If cleanup fails, refresh and retry deletion; the parent remains locked against edits until deletion finishes. External file deletion cannot be rolled back, so files successfully removed before a later failure remain removed. Never clear failed file references just to dismiss the error.

This change prevents new leftovers through these CRM delete actions. It does not automatically purge records/files left behind by earlier versions or delete untracked uploads. Firestore deletion reduces stored data but itself uses writes; normal reads/writes, file storage, and other quotas still apply, so cleanup cannot guarantee remaining within Spark limits.

## 1. Record your Firebase owner UID and existing assignment IDs

Open **Firebase Console → Authentication → Users**, find your actual owner account, and copy its UID. Use the UID, not the email address or a Firestore document's display name.

If old leads/projects use a legacy user ID rather than this Firebase UID, record the approved mapping for each affected user. Check `assignedTo` on their existing leads/projects and `appUserId` in their existing profile. Verify that each ID belongs to that account; the server deliberately ignores browser-writable profile aliases. Existing Admin-issued `appUserId` claims are retained when there is no explicit mapping.

No CRM records are deleted or bulk migrated by this deployment. Without a mapping or existing trusted claim, the account uses its Firebase UID, so records assigned to a different legacy ID may be hidden.

## 2. Set Vercel server environment variables

In **Vercel → your CRM project → Settings → Environment Variables**, keep your existing Blob and frontend Firebase variables. Add these to the intended deployment environment:

| Variable | Value |
| --- | --- |
| `CRM_OWNER_UIDS` | Your verified Firebase owner UID. Multiple authorized recovery UIDs can be comma-separated. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full Firebase service-account JSON for the same project as the frontend. Reuse the existing valid value if already configured. |
| `CRM_USER_ID_MAP` | Optional JSON object mapping verified Firebase UIDs to approved existing CRM IDs. |

Example mapping, with placeholders to replace:

```json
{"FIREBASE_OWNER_UID":"EXISTING_OWNER_CRM_ID","FIREBASE_AGENT_UID":"EXISTING_AGENT_CRM_ID"}
```

If Firebase Admin is already configured with `FIREBASE_SERVICE_ACCOUNT_BASE64`, reuse it instead of adding JSON; Base64 takes precedence if both are present. To obtain a service account, use **Firebase Console → Project settings → Service accounts → Generate new private key**. Paste the complete JSON, including its private key, into the server variable. These credentials and `CRM_*` variables must never have a `VITE_` prefix or be committed to Git. Blob credentials alone cannot manage Firebase roles or write Firestore.

The service account must have permission to read/write this project's Firestore database and manage Firebase Authentication users/custom claims. `FIREBASE_PROJECT_ID`, if already set, must match its `project_id` and the frontend's Firebase project.

Use the same Vercel origin for the browser and API; leave `VITE_API_BASE_URL` unset for this arrangement. Avoid pointing Preview deployments at production Firebase data unless that is intentional. New variables take effect after redeployment.

## 3. Publish the Firestore rules

Back up the currently deployed rules. In **Firebase Console → Firestore Database → Rules**, replace them with this repository's complete `firestore.rules` and publish. Coordinate this with the code rollout: the old frontend cannot create profiles or mark leads Won under the new rules.

The new rules require server-issued identity claims, restrict role/identity writes to the Admin endpoints, and reserve the transition to Won/client linking for conversion. The existing malformed lead/project rule expressions are also corrected.

Alternatively, with Firebase CLI authenticated to your project:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

This command deploys rules/indexes only. It does not deploy Functions or require enabling Functions billing. Existing database availability and Firebase quotas still apply.

## 4. Deploy this code to Vercel

Save the reviewed changes to the Git branch connected to your Vercel project, then deploy that revision. Cloud workspace edits do not automatically appear in GitHub or Vercel.

For a new import, choose your CRM Git repository and use:

- Framework: **Vite**.
- Root directory: repository root.
- Install command: `npm ci`.
- Build command: `npm run build`.
- Output directory: `dist`.
- Node version: a Vercel-supported version meeting Firebase Admin's Node 20+ requirement. Local verification used Node 20.20.2.

Keep `vercel.json`: it resolves API files before the SPA fallback. A plain static upload of `dist` cannot run these endpoints. Check that the deployment contains the three new API routes and the existing portal/Blob routes.

## 5. Restore owner access and verify

1. Sign out, close the installed PWA/browser tab, reopen the newly deployed CRM, and sign in with your owner account. If an old service worker still serves the previous UI, reload/update the app or clear that site's cached app files.
2. The sign-in request to `/api/auth/ensure-role` should return 200. The server creates/repairs `/users/{YOUR_UID}`, assigns the owner role for the configured recovery UID, and updates Firebase claims. The frontend refreshes the token before entering the CRM.
3. Confirm owner navigation and data access. You do not need to manually type a role into a Firestore profile or deploy the old `ensureRoleClaim` Function.
4. Convert a test lead assigned to your account. Check that it becomes Won with one linked client. Try conversion with an optional project; confirm its package, assignment, and milestones. Repeating/retrying the same conversion must reuse its client/project. A later conversion can add a project to a client-only conversion.
5. Sign in as an agent and check assigned records, including approved legacy assignments. Another agent's lead must be inaccessible.
6. Check role changes using a non-recovery test account. Users changing roles should sign out and back in; demotion revokes their existing refresh tokens. Recovery accounts cannot be demoted through this endpoint while listed in `CRM_OWNER_UIDS`.
7. Test an existing client-portal share and a Blob upload/download using your existing environment variables.

Conversions do not delete duplicate historical clients. An inconsistent existing client/project link produces an error for manual review rather than silently creating another record. Resolve duplicates after backing up those records.

## Troubleshooting

- **Recovery configuration error:** verify the service-account JSON/Base64, project IDs, server variables, and Firebase IAM permissions; redeploy after updating variables. Inspect Vercel function logs without sharing the private key.
- **Still an agent:** verify `CRM_OWNER_UIDS` exactly matches the signed-in Firebase UID and applies to this deployment. Sign out/back in after redeployment.
- **API unavailable / HTML response:** deploy the repository with its `api/` files, rather than only the static `dist` folder. Check the origin and routing.
- **Permission denied on records:** publish the new rules, refresh the token, and verify the approved legacy ID mapping.
- **Missing Firestore index:** follow Firebase's index link or deploy `firestore.indexes.json`; wait until the index is ready before retrying.

## Scope and costs

This is a migration of owner recovery, role changes, and lead conversion. Payment reconciliation, commission triggers, scheduled reminders, and push delivery still have Firebase Functions implementations under `functions/`; this change does not restore those services if they are blocked by billing. The broader audit remains a separate repair list.

Vercel compute, Blob, and Firebase Auth/Firestore all have separate quotas; moving these endpoints does not remove Firebase database limits. Vercel Hobby eligibility also needs checking for a business CRM: its published policy has limited Hobby to personal, non-commercial use. Current numeric allowances were not verified from this environment; check the current plan and Blob usage in your Vercel dashboard before relying on a free deployment.

## Local verification

```sh
npm ci
npm run test
npm run test:api
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm run build
```

`npm run dev` serves the Vite UI only. To exercise actual API routes locally, use Vercel's local development runtime with server credentials. Automated API tests use a fake Auth/transaction store and never touch production records; a live deployment check is still required.

Validation for the migration and deletion update: 31 server regression tests and 17 frontend/domain tests passed; TypeScript checking and the production/PWA build passed. Lint retained nine existing warnings and no errors. The earlier migration browser smoke check with mocked authentication and empty service fixtures rendered eight routes at desktop/mobile widths without runtime errors. The Firestore emulator download was blocked by the environment's network proxy (HTTP 403), so emulator rules validation remains unverified; Firebase Console will compile the rules when you publish them. Test deletion against disposable linked records after deployment, including a protected invoice and a portal file.
