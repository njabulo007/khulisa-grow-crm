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

This codebase is already structured with a service boundary so Firebase integration can happen with minimal UI/page changes.

### 1) Where to Plug in Firebase Auth

- Replace `src/services/authService.ts` internals:
  - `loginWithPassword` -> `signInWithEmailAndPassword`
  - `clearCurrentUser` -> `signOut`
  - `getCurrentUser`/session bootstrap -> `onAuthStateChanged`
- Keep the `AuthService` interface stable so `src/contexts/AuthContext.tsx` and pages do not need major rewrites.
- Role/profile fields should be sourced from Firestore user profile documents (or custom claims) instead of local seed/localStorage.

### 2) Where to Plug in Firestore

- Replace localStorage-backed logic in each service:
  - `src/services/leadService.ts`
  - `src/services/clientService.ts`
  - `src/services/projectService.ts`
  - `src/services/invoiceService.ts`
  - `src/services/paymentService.ts`
  - `src/services/commissionService.ts`
  - `src/services/activityService.ts`
- Map existing CRUD methods (`getAll`, `getById`, `create`, `update`, `remove`) to Firestore `collection`, `doc`, `getDocs`, `addDoc`, `updateDoc`, `deleteDoc`.
- Keep direct data access inside services only. Components/pages/hooks should continue calling services, not SDK APIs directly.

### 3) Where to Plug in Storage

- Use `src/services/storageService.ts` as the integration point for Firebase Storage.
- Future use cases:
  - Project assets upload/download
  - Invoice PDF upload/download
- Replace placeholder methods with `ref`, `uploadBytes`, `getDownloadURL`, and `deleteObject`.

### 4) Minimal-Change Rule

- Keep public service interfaces stable.
- Keep pages/components data-driven through hooks/services.
- When migrating to Firebase, most changes should stay inside `src/services/*` and auth bootstrap logic.
