# Gmail Notification Relay: Operations and Handover

Last verified: 2026-11-19

## Purpose

The application sends approval and account-related notifications through a Google Apps Script Gmail relay. The visible sender address is `app@tenx.jp`.

This document records the current ownership risk and the steps required to transfer the relay to a future system administrator. Do not store passwords, relay secrets, recovery codes, or API keys in this repository.

## Current Configuration

| Item | Current state |
|---|---|
| Sender address | `app@tenx.jp` |
| Address type | Google Workspace email alias, not an independent user account |
| Alias owner | `y.nakatani@tenx.jp` |
| Apps Script project | `10X Apps Gmail Relay` |
| Apps Script project ID | `1Bnf9h4QU2mCJO2rn-I403n6dJ5uJ8le02exOyJ1J9q9qh5znPb2c-YYi` |
| Relay source in this repository | `google-apps-script/gmail-relay/Code.gs` |
| Supabase secrets used by the relay | `GMAIL_RELAY_URL`, `GMAIL_RELAY_SECRET` |

The Apps Script sends mail using the Gmail authority of its executing owner. `app@tenx.jp` is configured as a send-as alias for that account.

## Accepted Temporary Risk

The current relay depends on `y.nakatani@tenx.jp` in two ways:

1. `app@tenx.jp` is an alias of that account.
2. The Apps Script project and Gmail execution authority are controlled by that account.

If the account is suspended, deleted, loses Gmail access, or loses the send-as alias, application notifications may stop. Reassigning only the alias is not sufficient because the Apps Script ownership, deployment, and authorization must also be transferred.

This dependency is accepted temporarily. The account must not be suspended or deleted until the handover checklist below has been completed and tested.

## Recommended Target Configuration

Create a non-personal Google Workspace account such as `system@tenx.jp` or `app-notify@tenx.jp` and manage it as an internal technical account.

- Assign `app@tenx.jp` as its sender alias.
- Transfer or recreate the Apps Script relay under that account.
- Limit access to designated system administrators.
- Store recovery information and secrets in the company-approved password or secret manager.
- Review access when the system administrator changes.

This requires a Google Workspace license but removes dependence on an individual employee account.

## Handover Checklist

Complete these steps before suspending or deleting the current owner account:

1. Create or designate the successor Google Workspace technical account.
2. Grant the successor administrator access to Google Workspace, Supabase, GitHub, and Cloudflare as required for operations.
3. Transfer the Apps Script project or create a copy owned by the successor account using `google-apps-script/gmail-relay/Code.gs` as the source of truth.
4. Remove `app@tenx.jp` from the current owner and add it as an alias of the successor account. Plan for a short mail interruption while the alias is moved.
5. Configure and verify `app@tenx.jp` as a Gmail send-as address for the successor account.
6. Confirm that `GmailApp.getAliases()` includes `app@tenx.jp` when executed by the successor account.
7. Set the Apps Script property `GMAIL_RELAY_SECRET`. Rotate the value during handover instead of copying it through chat or source code.
8. Deploy the Apps Script as a web app that executes as the successor account.
9. Update the Supabase Edge Function secrets `GMAIL_RELAY_URL` and `GMAIL_RELAY_SECRET` to match the new deployment.
10. Send test notifications for approval request, approval, rejection, and account registration.
11. Perform an end-to-end test from each application that uses the relay. Verify the recipient, sender, subject, body, links, inline images, and attachments.
12. Check Supabase Edge Function logs and the Apps Script execution log for errors.
13. Only after successful testing, remove the current owner's access or suspend the account.

## Verification After Handover

The handover is complete only when all of the following are true:

- Messages are delivered from `app@tenx.jp`.
- The successor account owns or controls the active Apps Script deployment.
- The current owner account can be suspended without interrupting notifications.
- No secret values exist in Git, documentation, email, or chat history.
- At least one other authorized administrator knows where this document and the operational credentials are stored.

## Failure Indicators

Typical symptoms and likely causes:

| Symptom | Likely cause |
|---|---|
| Apps Script reports `Sender alias is not available` | `app@tenx.jp` is not configured for the executing account |
| Supabase function reports relay failure | Relay URL, relay secret, deployment access, or Apps Script execution failed |
| Mail uses the personal address as sender | Gmail send-as alias is missing or the wrong account owns the deployment |
| No notification after an account is suspended | The relay still depends on the suspended account |

## Change Control

- Do not change the alias owner, Apps Script deployment, or Supabase relay secrets independently.
- Make these changes as one planned maintenance operation and test before closing the maintenance window.
- Record the date, operator, new technical account, test results, and rollback decision in the internal change log.
- Do not commit temporary test-send functions to the Apps Script production source.
