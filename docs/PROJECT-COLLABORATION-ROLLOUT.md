# Project file, milestone and conversation workspace

## Rollout

Deploy `main`, reopen the CRM/PWA, and refresh an existing client link. This reuses Firebase Admin, existing Vercel Blob encryption, bell/FCM delivery and the existing Vercel endpoints. No new storage service, paid messaging subscription, environment variable, scheduled job, composite index or production migration is required. The repository's deny-by-default Firestore rules must already be installed; new collections are server-only. No existing token is rotated or invalidated.

Legacy link attachments remain available under **Previously shared files**. Their historical public Blob URLs cannot be made private just by hiding a button. New uploads should use **Project collaboration → Files & Deliverables**, which stores encrypted bytes and checks access for downloads. The old administrator upload path is retained behind an explicit **Legacy public media upload** section for deliberately public media and compatibility. Moving/deleting those historical objects or invalidating their URLs would be a separate approved migration.

## File workflow

On a project, open **Project collaboration → Files & Deliverables**. Upload a new file or choose an existing file under **Upload target** to save a replacement. PNG, JPG, WebP and PDF are allowed up to 2 MB each. The library holds 20 files and three versions per file. This bounds library bytes to roughly 120 MB per project, in addition to onboarding materials and historical shares. Monitor total Blob storage and transfer usage; these are limits, not a promise of unlimited free storage. Larger media can use the agreed project folder or the existing explicitly public legacy workflow when appropriate.

New team uploads and new replacement versions start private. Use **Category, visibility & milestone → Client-visible → Save file details** to publish the latest version. Already published older versions remain accessible while a replacement is drafted. Earlier unpublished drafts do not become public when the latest version is published. **Team-only** hides all versions from the client API. All downloads recheck the current live share or current team assignment.

Categories: Client Uploads, Brand Assets, Website Content, Project Previews, Final Deliverables. Link a file to an existing milestone and use **Client attention needed** where a review/action is required. Attention flags are separate from formal approval; downloading a file does not approve it. Clients see only authorised, published versions and their own pending-upload status. Onboarding materials are referenced without copying storage, with downloads still authorised through the project. Their checklist/submission history is managed in Onboarding.

Clients upload encrypted project materials from **Files & Deliverables**, see progress and confirmations, filter by category, view published history and download authorised versions. Client-created files are visible only within that live project workspace. Only the original uploader's live share may delete an eligible client-only file; client deletion is blocked once team work/versions are added or the file is categorised as a preview/final deliverable. Team file deletion requires the original team uploader or developer. Deleting a file explicitly removes all retained versions after confirmation.

Server validation checks MIME, extension, file signature, byte limits and safe filenames; generated storage paths never use user filenames. This is not an antivirus service. Keys and Blob paths are not exposed in public responses. Upload leases, per-project daily reservations (10 client / 20 team), optimistic versions and stable operation IDs protect retries. Replaying an earlier upload cannot overwrite a different pending replacement. Failed upload/deletion keeps references for retry, and parent deletion cleans every retained version before removing records. Pending versions can be retried with the original file; active uploads block deletion for two minutes.

## Milestones

Existing milestone IDs, array order, custom rows, aliases and completion history remain. Legacy rows missing an ID get stable IDs when explicitly updated, rather than duplicate rows. Statuses: Not Started, In Progress, Awaiting Client, Under Review, Completed, Blocked. The current delivery coordinator and developer can edit status, responsible party, expected date, description, client action and prerequisites; other assigned contact managers retain read access.

The portal, dashboard helpers and CRM derive completion from the same status/legacy-flag rules. Time passing never completes a milestone. A project without configured milestones displays that progress is unavailable. Next-step selection respects recorded order, completed prerequisites and who must act. Dependency cycles, cross-project prerequisites, invalid dates and completing a dependent step before its prerequisite are rejected. A prerequisite cannot be reopened while a completed dependent still relies on it.

Changes are transactional, update the project and progress, create client activity with a project reference, and notify current staff through the existing notification system. Unchanged status/details create no activity or notification. Retry notices use the same notification ID and existing push deduplication. Existing final-completion rules remain: an agent completing all steps leaves final project completion for the developer; a developer completing the final step can close delivery. On Hold remains an explicit hold. Clients cannot change milestones or project status.

## Conversations

Use **Messages & Feedback → New conversation** for project questions and discussion. Conversations are visible to that project's client and currently authorised team. Client sender names are supplied through the bearer link, not verified client identities; team names come from canonical staff profiles.

Every saved message has a sender, timestamp, project reference and immutable content. Up to three already-published project files may be attached. Attachments pin the version that was sent; replacing a file does not silently change an earlier message's attachment. Hiding or deleting a file also removes access through old messages, with an unavailable-attachment note.

Staff can reply, explicitly request a client response, assign a current project team member, mark a thread read, and resolve or reopen a matter. Clients can mark read and reply, but cannot set responsibility or resolution. A new reply reopens a resolved conversation. Pending client questions appear in the portal's next-action card. Read receipts are explicit, not proof that a particular named person read the message.

These are asynchronous conversations. Use **Refresh workspace** or reopen a section to get the latest messages; no per-message realtime listeners were added. Lists load 20 summaries at a time with Load more; filters apply to loaded topics. Each conversation holds up to 50 messages of 4,000 characters; start a new related topic after that. Client mutations share a 60-write daily project limit. Messages are retained until the protected project/client deletion flow removes them.

A question or reply does not create a scope change, a quote, an invoice, a formal approval or a completed milestone. Use the existing Approvals & Requests workflow for those decisions. Staff receive notifications through existing supported bell/FCM channels; anonymous client links do not create a new client push account or automatically send email. Staff can use the existing contact/template tools when an external reminder is needed.

## Production smoke checks

Local validation: 180 API tests and 86 frontend tests pass, TypeScript checks and production build pass. Chromium checks at desktop (1280 px) and mobile (390 px) cover private publishing, replacement/history downloads, milestones, conversations, assignment/resolution, retry after a successful write followed by a failed read, and revoked-share blocking. Identity, Firestore and Blob services are simulated in these browser checks.

1. On a test project, upload a team preview and confirm it is absent from the client file list and download API before publishing.
2. Publish it, link it to a milestone, flag client attention, and download it as the client.
3. Replace it privately: verify the older published version remains accessible and the new draft is absent. Publish the replacement and test version history.
4. Upload a client material. Check that another project's share and an unrelated/former manager cannot list or download it. Revoke a test share and verify reads/uploads/downloads/messages fail closed.
5. Update a milestone with a client action and expected date, and confirm progress/next step without marking it completed. Check dependency rejection and the existing final-completion rules.
6. Send a client question with an attachment. Reply, assign responsibility, request a response, mark read and resolve. Confirm the formal approval/request records are unaffected.
7. Test real Blob transfers and Android push delivery. Local tests use simulated identity/storage and exercise actual handlers/components; they do not prove production credentials, deployed rules or physical device delivery.
