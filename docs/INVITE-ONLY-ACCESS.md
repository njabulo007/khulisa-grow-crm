# Invite-only CRM access

Public sign-up has been removed from the login page, auth context and browser service. Login remains available for existing accounts. Existing canonical CRM members, accounts with previously issued server role claims, and configured recovery owner UIDs are preserved; this change does not delete or archive anyone.

The Vercel authentication gate rejects unapproved Firebase accounts before allowing CRM API actions. Role recovery no longer turns a new Firebase account into an agent. Firestore rules require both server-issued role claims and a canonical CRM profile, including for creating a lead or registering a push device. The legacy Firebase role recovery source also rejects unknown accounts and no longer treats an unverified email as owner authorization.

## Required production step

Deploy the latest Vercel build, then publish this repository's complete `firestore.rules` in **Firebase Console → Firestore Database → Rules → Publish**. Vercel deployment does not publish Firebase rules. Alternatively, from an authorized Firebase CLI session run `firebase deploy --only firestore:rules --project khulisa-grow-crm`.

Keep Email/Password sign-in enabled so existing staff and invited agents can log in. Firebase's public authentication configuration is designed to be visible in the browser. On the current Spark setup, removing CRM sign-up does not itself disable Firebase's raw account-creation API: an outsider may still create an unapproved Auth record, but the updated API gate and published rules deny it CRM access. Do not describe this as a project-wide Firebase account creation block. Already admitted accounts retain access and should be reviewed separately in Team & Access if their approval is uncertain; archiving a roster entry does not disable its Auth login.

If legacy Firebase Functions are actually deployed, update or disable the obsolete role recovery function too. This CRM uses Vercel for recovery; no Firebase Functions deployment or paid plan is required for this feature.

## Invite someone

1. As owner, open **Settings → Team & Access → Invite an agent**.
2. Enter the person's full name and email, then choose **Create invitation**.
3. Copy the private password-setup link and share it directly with that person. No email or message is sent automatically.
4. They choose a password on Firebase's hosted password-reset screen, then return to the CRM login page and sign in with that email.

New invitations always grant **Agent** access. An owner can change roles later using the existing Team & Access controls. The owner remains signed in throughout because account provisioning happens on the server. No temporary password is returned to the browser. The initial password is cryptographically random and unknown to the invited person until they set their own password through the setup link.

Firebase controls setup-link expiry and single-use validation. If a pending invite expires or its response was interrupted, enter the same email and create the invitation again to obtain another link without creating a duplicate account. After first successful CRM login, the invitation is no longer pending. Existing admitted accounts cannot be reset through the invitation form.

A pre-registered but unapproved Firebase email account is rejected rather than silently promoted: another person might know its password. Review the account in Firebase Authentication before taking any manual action. Disabled accounts are also rejected. Setup links are secrets; the UI does not store them in local storage or write them into Firestore, and the server does not log them.

## Verification

Automated API tests cover unauthorized raw Firebase users, existing member and owner recovery, owner-only invitation creation, least privilege, pending invitation retries, malformed payloads, disabled accounts and pre-registered accounts. Browser checks cover login-only rendering, owner invitations and agent restrictions on desktop and phone layouts.

Production Firebase sign-in, hosted password setup and published Firestore policy require live verification. The Firestore emulator download was blocked by the environment's network domain policy, so emulator execution was unavailable here; the Firebase console validates rules before publication.
