# Payment follow-ups

On an unpaid invoice, use **Payment follow-up** to choose a date and write the next action or promise to pay. **Invoices → My payment follow-ups** lists the schedules, due dates, and outstanding balances. The client page also has a **Payment follow-up** link on unpaid invoices.

Each owner or assigned agent schedules their own reminders. They cannot edit financial records through this feature or schedule notifications for another account. Reschedule after contacting the client or use **Stop reminders**. **Log client contact** opens the existing client activity log. These are internal CRM reminders; no email or WhatsApp message is sent to the client.

## Enable reminders when the PWA is closed

1. In Vercel, open the CRM project → **Settings → Environment Variables**.
2. Add **CRON_SECRET** with a random private value of at least 32 characters, scoped to **Production**. For example, generate one locally with `openssl rand -hex 32`. Keep it private; do not prefix it with `VITE_`.
3. Redeploy the latest `main` deployment after saving the variable.
4. Open **Settings → Cron Jobs** and confirm the `/api/notifications/push` job is present with schedule `0 7 * * *`.
5. Register push notifications on each receiving device through the CRM bell menu, as with the existing push test.

The same job also processes [lead follow-ups](LEAD-FOLLOW-UPS.md); it needs no second cron job or secret.

The production job runs daily around **09:00 South African time (07:00 UTC)**. Vercel Hobby scheduling can run within the scheduled hour; this is not an exact-minute alarm. Scheduled reminders are checked from their follow-up date and repeat daily while the balance remains unpaid. The CRM also checks the signed-in user's due reminders when opened or brought into focus, throttled to once every five minutes. Saving a reminder for today starts a check immediately.

There is no Firebase Functions deployment, Blaze upgrade, new API function, or Firestore rules change. The server keeps the reminder collection private and uses the existing Firebase Admin and FCM configuration. Ordinary Firestore, Vercel compute, and push quotas still apply. Vercel's separate commercial-use plan policy still applies.

## Validation and troubleshooting

- Schedule today's follow-up from a desktop signed into the same account as a registered phone. The phone can have the PWA closed. The saved bell item and push should name the invoice and remaining balance; opening it goes to the invoice.
- For a scheduled background test, choose tomorrow, close the phone PWA, and check the next day's notification after the morning job. Production scheduling cannot be verified from a local build.
- Paid invoices, fully settled partial payments, draft invoices, removed invoices, and reassigned records do not generate reminders. Disabled or deleted accounts stop receiving reminders. A failed push keeps its saved bell item and can be retried without duplicating a successfully delivered push.
- If background setup is missing, the UI displays an owner setup notice. Foreground checks continue to work. A GET to the cron endpoint requires Vercel's `Authorization: Bearer CRON_SECRET` header; do not share the secret in screenshots or logs.
- Review the cron run and `/api/notifications/push` logs in Vercel for scheduler errors. Notifications retain the existing `pushStatus`, device counts, and error codes. The cron returns an error status if some reminder deliveries fail.

Reminder dates use South Africa's calendar. Amounts come from the existing package/items total and recorded payments; reminders do not change invoice totals or payment records. Duplicate checks create one reminder notification per invoice, account, and calendar day. Deleting the parent invoice cleans up its schedules and related notifications.
