# Khulisa Grow CRM

Khulisa Grow CRM is a Vite + React + TypeScript application for managing leads, clients, projects, commissions, invoices, reports, and settings.

## Getting Started

```sh
npm install
npm run dev
```

## Available Scripts

- `npm run dev`: start the Vite dev server
- `npm run build`: build for production
- `npm run build:dev`: build using development mode
- `npm run preview`: preview the production build
- `npm run lint`: run ESLint
- `npm run test`: run tests once with Vitest
- `npm run test:watch`: run Vitest in watch mode

## Tech Stack

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui components

## Firebase Migration Notes

This codebase is now wired so the service layer is the only data-access boundary.

### 1) Where to Plug in Firebase Auth

- `src/lib/firebase.ts` initializes Firebase app/auth/firestore/storage.
- `src/services/authService.ts` is the integration point for:
  - `signInWithEmailAndPassword`
  - `onAuthStateChanged`
  - `signOut`
- Keep auth/session logic in `authService` + `src/contexts/AuthContext.tsx` so pages stay unchanged.

### 2) Where to Plug in Firestore

- These services are Firestore-backed and should remain the source of truth:
  - `src/services/leadService.ts`
  - `src/services/clientService.ts`
  - `src/services/projectService.ts`
  - `src/services/invoiceService.ts`
  - `src/services/paymentService.ts`
  - `src/services/commissionService.ts`
  - `src/services/activityService.ts`
- Shared adapter: `src/services/storage.ts` -> `FirestoreCollection<T>`.
- Keep components/hooks/pages calling services only; do not call Firestore directly from UI modules.

### 3) Where to Plug in Storage

- Use `src/services/storageService.ts` as the integration point for Firebase Storage.
- Future use cases: project assets and invoice PDFs.
- Implement with `ref`, `uploadBytes`, `getDownloadURL`, `deleteObject`.

### 4) Minimal-Change Rule

- Keep public service interfaces stable.
- Keep pages/components data-driven through hooks/services.
- New persistence/provider changes should stay inside `src/services/*` and `src/lib/firebase.ts`.

### 5) Legacy Local Storage

- CRM entity persistence no longer uses localStorage.
- Obsolete local keys are listed in `src/services/storage.ts` as `OBSOLETE_CRM_STORAGE_KEYS`.
- Local storage is still used for:
  - auth/session compatibility (`khulisa_users`, `khulisa_current_user`, `khulisa_role`)
  - UI theme preference (`khulisa_theme`)

## Web Push Notifications (System-Level)

This app includes FCM-based web push plumbing so agents/owners can receive OS notifications while the app is in background, tab is inactive, or phone screen is off.

### Client setup

1. Create a Firebase Web Push certificate key pair in Firebase Console:
   - Project Settings -> Cloud Messaging -> Web Push certificates
2. Add the public VAPID key to your frontend env:
   - `VITE_FIREBASE_VAPID_KEY=YOUR_PUBLIC_VAPID_KEY`
3. Ensure your app is served over HTTPS (required for push).

### Backend trigger setup

Push delivery is sent from Firebase Functions when a document is created in `notifications`.

1. Install dependencies:
   - `cd functions`
   - `npm install`
2. Deploy functions:
   - `npm run deploy`

The function `sendWebPushOnNotificationCreate` reads device tokens from `push_tokens` and sends an FCM web push with:
- deep link payload (`/leads/:id`, `/clients/:id`, `/projects/:id`, `/invoices/:id`)
- high-priority delivery
- OS-level notification presentation/sound (Android/desktop defaults)

### Notes

- Users must grant notification permission at least once.
- iOS web push requires installing the PWA to home screen and enabling notifications.
