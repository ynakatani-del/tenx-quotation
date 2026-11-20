# Onboarding Email Notification Operations

Last updated: 2026-11-20

## Purpose

When a new employee submits the public onboarding form, the application sends an administrative notification through the shared Gmail relay. Google Chat and browser-side webhook delivery are not used.

The email contains only the applicant name, planned employment date, and a link to the protected onboarding administration screen. My Number, bank account, address, dependent, emergency contact, and uploaded-file data remain in Supabase and are not copied into the notification email.

## Components

| Component | Responsibility |
|---|---|
| `src/pages/OnboardingForm.jsx` | Saves the submission, then invokes the notification function |
| `supabase/functions/send-onboarding-notification/index.ts` | Claims one recent submission, resolves the recipient profile, and sends mail |
| `supabase/functions/_shared/gmail.ts` | Calls the shared Gmail relay |
| `supabase/migrations/20261120085546_switch_onboarding_notifications_to_email.sql` | Adds notification evidence columns and removes the legacy anonymous mail RPC |

## Required Supabase Secrets

The existing Gmail relay secrets are reused:

- `GMAIL_RELAY_URL`
- `GMAIL_RELAY_SECRET`

The onboarding function also requires:

- `ONBOARDING_NOTIFY_PROFILE_ID`: UUID of the designated onboarding administrator in `public.profiles`
- `ONBOARDING_APP_URL`: normally `https://tenx-joinform.pages.dev`

Do not use a fixed email address in source code or store secret values in Git. The Edge Function obtains the current recipient email from the designated active administrator profile each time it sends a message.

## Delivery and Retry Rules

- Only a submission created within the preceding 30 minutes can trigger a notification.
- The database row is claimed before delivery to prevent repeated browser requests from sending duplicate mail.
- A failed attempt can be retried after five minutes.
- `onboarding_notification_attempted_at`, `onboarding_notification_sent_at`, and `onboarding_notification_error` provide operational evidence.
- A notification failure does not roll back or delete the submitted onboarding data.

## Deployment Checklist

1. Confirm that the designated profile is active and has the `admin` or `super_admin` role.
2. Set `ONBOARDING_NOTIFY_PROFILE_ID` and `ONBOARDING_APP_URL` as Supabase Edge Function secrets.
3. Apply the onboarding notification migration.
4. Deploy `send-onboarding-notification` with JWT verification enabled.
5. Build and deploy the Cloudflare Pages application only after user approval.
6. Submit one test record using non-sensitive test values.
7. Verify the recipient, `app@tenx.jp` sender, subject, body, administration link, and database notification timestamps.
8. Confirm that no Google Chat request appears in the browser network log.

## Related Documentation

- [Shared internal application platform guide](https://github.com/ynakatani-del/tenx-portal/blob/main/docs/internal-app-platform-guide.md)
- [Gmail relay operations and handover](gmail-notification-relay-operations.md)
