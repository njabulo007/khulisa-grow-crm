# Agent acquisition and client success tools

All agent access remains limited to assigned leads/projects and their linked clients/invoices. Owner access remains organization-wide.

| Workflow | Agent capabilities | Status |
| --- | --- | --- |
| Acquisition | Capture leads, manage pipeline stages, schedule lead follow-ups, log calls/emails/WhatsApp/meetings, convert a won lead to its client/project | Already available |
| Client onboarding | Edit assigned client contact/business details and contract/onboarding flags; update onboarding directly from the client page | Existing editing plus new direct access |
| Relationship history | Read and log client notes, calls, emails, WhatsApp conversations, and meetings in the client record | Existing activity service exposed on the client page |
| Delivery | Update assigned project milestones; set Not Started, In Progress, On Hold, or Waiting for Client | Newly enabled |
| Client communication | Publish the assigned project's client-facing portal update | Newly enabled |
| Payment follow-up | Read linked invoice amounts, amount paid, balance, dates/status, and payment history; print/save an invoice PDF using the browser | Newly enabled; read-only |
| Personal earnings | See their own commissions and performance | Already available |
| Notifications | In-app bell and background push when registered | Already available |

The client activity form records an interaction; it does not automatically send messages. Final project completion/reopening, prices/packages, assignments, invoice issue/edit/delete, payment recording, commissions/payout changes, team management, organization reports, and portal link/file administration remain owner-controlled. Agents cannot edit closed delivery checklists. Completing the last milestone as an agent leaves the project In Progress until the owner confirms completion, preserving portal access.

## Rollout

Let Vercel deploy `main`, then publish the updated `firestore.rules` in Firebase Console → Firestore Database → Rules. If the preceding consistency rollout has not been applied, run **Clients → Repair assignments** as the owner before publishing the rules. No new environment variables or Vercel routes are required.

## Recommended next additions

1. **Client follow-up tasks and reminders:** a next contact date, task owner, priority, and daily queue after conversion. Lead follow-up dates already exist; client follow-up tasks do not.
2. **Client health and escalation:** Healthy / Needs Attention / At Risk, reason, last contact, and an owner escalation action.
3. **Quote/proposal requests:** agents prepare scope and request an owner-approved price, then share the approved proposal. Invoice creation remains owner-only today.
4. **Client approvals and feedback:** request approval on a shared design/file and keep a dated decision history instead of relying on chat screenshots.
5. **Renewal and upsell tracking:** renewal dates and linked opportunities so an existing client can buy another service without creating a duplicate client.
6. **Approved communication templates:** WhatsApp/email drafts for introductions, onboarding, progress updates, and payment reminders; actual sending remains explicit.

Start with client follow-up tasks and health/escalation: they close the largest gap between winning a lead and retaining the client. These are suggestions, not features implemented in this update.
