# Lead follow-ups

Open a lead and use **Lead follow-ups** to set its reminder date. After contacting the prospect, select the contact method, write the outcome using the formatted notes editor, and choose **Complete follow-up**.

**Schedule another follow-up** is optional. If selected, choose the next date; otherwise completion clears the current reminder date. You can schedule another later. There is no two-follow-up limit. Each completion is numbered and retained in the activity timeline with its outcome, previous date, and optional next date. Notes and the next reminder date are saved together; retrying a completed request does not duplicate its activity.

The Leads page includes filters for **Due / overdue**, **Upcoming follow-ups**, and **No follow-up date**. Won and lost leads are excluded from these active follow-up filters and do not receive acquisition reminders. Owners can manage all leads; agents can manage only their assigned leads. Reminders go to the assigned agent, even if the owner sets the date.

## Closed-PWA reminders

Lead and payment follow-ups share the existing authenticated `/api/notifications/push` endpoint and daily Vercel cron. Follow the [payment reminder setup](PAYMENT-FOLLOW-UPS.md) to configure production `CRON_SECRET`, redeploy, confirm the cron job, and enable push on each receiving device. If already configured, no additional variable or cron is needed.

The job runs around 09:00 South African time daily, within Vercel Hobby's scheduled hour. Reminders start on the chosen date and repeat daily while overdue. Opening or focusing the CRM also checks the signed-in user's due reminders. Existing lead dates are picked up automatically. Saving a date for today or completing with another date for today requests a foreground check immediately. Saving dates in the general lead edit form is picked up by the next check or daily job.

Clearing the date, completing without another date, marking the lead won/lost, removing the lead, disabling the assigned account, or removing its assignment stops future reminders. Rescheduling changes the reminder cycle. Already delivered notifications remain in history. Notifications are internal staff reminders; contact methods log what happened and do not send messages to the prospect.

## Test after deployment

Schedule a lead for today assigned to an agent with a registered phone. Leave the phone PWA closed and save from another device signed into that agent account, or wait for the daily job. Verify the push opens the correct lead. Record three or more follow-ups and check that all outcomes remain in the activity timeline. Complete the last one without another date and confirm the reminder date clears.

Local tests verify scheduling, authorization, retry protection and UI behavior with test records. Actual Android push delivery and the production cron require this deployment test. Firestore reads/writes and Vercel compute still count toward their normal quotas; this feature adds no Firebase Functions deployment or additional Vercel cron job.
