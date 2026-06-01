# Debra Agent Handover

This file gives Debra enough context to operate with the Instant Bees sales automation app without needing the original build chat.

## Product Context

Instant Bees is a local/hosted sales automation app for:

- Managing sending mailboxes
- Uploading lead segments
- Creating outbound campaigns
- Creating sequence steps
- Sending campaigns in safe batches
- Tracking sends, opens, clicks, replies, bounces, and deliverability
- Managing label/ICP-based variants inside a single campaign

The app is currently local during development:

```text
Frontend: http://localhost:3000
API: http://localhost:8080
API v1: http://localhost:8080/api/v1
```

## Auth

For `/api/v1/*` endpoints, use:

```text
Authorization: Bearer <CLAUDE_API_KEY>
Content-Type: application/json
```

## Main API Instruction File

Debra should also read:

```text
INSTANT_BEES_API_INSTRUCTIONS.md
```

That file contains the full campaign package JSON contract.

## Campaign Package Endpoint

Use this endpoint to create templates, segments, contacts, campaigns, sequence steps, variants, and attachments in one upload:

```text
POST /api/v1/campaign-packages
```

Top-level shape:

```json
{
  "templates": [],
  "segments": [],
  "campaigns": []
}
```

Campaigns are created as drafts. Do not launch automatically unless AJ explicitly asks.

## Required Campaign Defaults

Campaign objects should normally include:

```json
{
  "dailyLimit": 80,
  "batchSize": 5,
  "batchIntervalMinutes": 60,
  "sendWindowStart": "07:00",
  "sendWindowEnd": "19:00",
  "sendWindowTimezone": "Australia/Sydney",
  "sendWindowDays": "mon,tue,wed,thu,fri",
  "replyTo": "aj@designbees.com.au",
  "trackOpens": true,
  "trackClicks": true,
  "includeUnsubscribe": true
}
```

Important:

- Do not send `mailboxIds`.
- Instant Bees auto-rotates across all enabled/sendable mailboxes.
- Campaign send interval does not override mailbox warmup or mailbox daily limits.
- Mailbox caps win over campaign cadence.

## Mailbox Rules

Mailbox rules are controlled per account:

- `dailySendLimit`
- `warmupEnabled`
- `status`
- SMTP/IMAP credentials

Warmup schedule:

```text
Days 1-3: 5/day
Days 4-7: 10/day
Days 8-12: 15/day
Days 13-17: 20/day
Days 18-21: 25/day
Days 22+: 30/day, capped by mailbox dailySendLimit
```

The Accounts UI supports:

- Individual account edit
- Bulk edit selected accounts
- Daily limit display
- Effective today display
- Warmup toggle
- SMTP/IMAP details
- Test email

## Variables

Supported merge fields:

```text
{{firstName}}
{{lastName}}
{{company}}
{{title}}
{{email}}
```

Recommended body type:

```json
"bodyType": "text"
```

Use HTML only when the campaign genuinely requires designed HTML.

## Step Delays

`delayDays` is relative to the previous step.

Examples:

```text
Email 1 today: delayDays = 0
Email 2 on day 8: delayDays = 7
```

## ICP / Label Variants

Use variants inside a single campaign step when different ICPs need different copy but the rest of the campaign is the same.

Example:

```json
{
  "subject": "Default subject",
  "body": "Default copy",
  "bodyType": "text",
  "delayDays": 0,
  "variants": [
    {
      "labelName": "C1-FractionalCMO",
      "subject": "Fractional CMO subject",
      "body": "Fractional CMO copy",
      "bodyType": "text",
      "priority": 10
    }
  ]
}
```

Rules:

- Matching label gets that variant.
- No matching label gets the default step.
- Multiple matching labels use highest `priority`.

Use descriptive labels such as:

```text
C1-FractionalCMO
C2-Founder
C3-AgencyOwner
```

Avoid vague labels like only `C1`.

## Attachments

Attachments can be added to templates, steps, or variants.

URL attachment:

```json
{
  "attachments": [
    {
      "filename": "starter-pack.pdf",
      "url": "https://example.com/starter-pack.pdf",
      "contentType": "application/pdf"
    }
  ]
}
```

Base64 attachment:

```json
{
  "attachments": [
    {
      "filename": "brief.pdf",
      "contentBase64": "JVBERi0xLjcK...",
      "contentType": "application/pdf"
    }
  ]
}
```

Prefer links over large attachments for deliverability.

## Analytics Now Available

Growth Center includes:

- Campaign Funnel
- ICP/Label Performance
- Best Send Hours
- Best Send Days
- Link Performance
- Deliverability Health
- A/B Step Performance
- Template Performance
- Follow-up candidates
- Reply classification
- Timeline

## Monitor Replies v3

Monitor Replies v3 is the operating layer for Debra to watch inbound replies and decide what should happen next.

### Current App Support

Instant Bees has an inbox worker that can:

- Poll configured IMAP inboxes
- Match inbound replies to leads/campaigns when possible
- Track replies against send jobs
- Track bounces from delivery failure messages
- Mark leads as replied or bounced
- Increment campaign reply/bounce metrics
- Store inbound messages in `inbox_messages`

Reply and bounce tracking depends on mailbox IMAP being configured correctly.

Each mailbox should have:

```text
imapHost
imapPort
smtpUsername
smtpPassword/app password
```

For Gmail, default IMAP is:

```text
imap.gmail.com:993
```

For Outlook, default IMAP is:

```text
outlook.office365.com:993
```

### Reply-To Rule

Campaigns should include:

```json
"replyTo": "aj@designbees.com.au"
```

This routes normal recipient replies to AJ.

Important distinction:

- Campaign emails use campaign `replyTo`.
- Account test emails send to the same mailbox being tested and do not use campaign `replyTo`.

### Classification Categories

Debra should classify replies into these operational categories:

```text
interested
referral
objection
neutral
not_interested
unsubscribe
bounce
out_of_office
wrong_person
manual_review
```

### Suggested Actions

Debra should use these actions:

```text
interested: Flag as hot lead. Notify AJ. Do not auto-send another campaign step.
referral: Capture referred person/company. Notify AJ. Consider creating/updating lead.
objection: Flag for objection-handling follow-up. Do not spam.
neutral: Leave in campaign unless the message asks to stop.
not_interested: Stop campaign for that lead.
unsubscribe: Mark lead unsubscribed immediately.
bounce: Mark bounced. Stop campaign for that lead.
out_of_office: Keep lead active. Suggest follow-up after OOO return date if present.
wrong_person: Stop current contact or ask AJ whether to enrich/refind contact.
manual_review: Do nothing destructive. Notify AJ.
```

### Monitor Cadence

Recommended hosted Debra behavior:

```text
Run reply monitor every 5-15 minutes during business hours.
Run a lighter check every 30-60 minutes outside business hours.
Do not send automated replies without AJ approval unless explicitly configured.
Never continue a sequence for unsubscribed, bounced, or not-interested leads.
```

### What Debra Should Report

Debra should produce a concise reply monitor summary:

```text
New replies found
Positive replies
Objections
Unsubscribes
Bounces
OOO replies
Manual review needed
Campaigns/leads affected
Recommended next actions
```

### Monitor Replies v3 Safety Rules

Debra must:

- Treat unsubscribe requests as final.
- Stop outreach to bounced leads.
- Avoid sending follow-ups to positive replies unless AJ has reviewed.
- Avoid using open tracking alone as proof of engagement.
- Prefer click/reply signals over open signals.
- Keep a clear log of every recommended action.
- Never edit mailbox credentials unless explicitly asked.
- Never launch paused/draft campaigns without explicit approval.

### Future Hosted Agent Endpoint Idea

If Debra needs a dedicated hosted endpoint later, create one of these:

```text
GET /api/v1/replies/recent
POST /api/v1/replies/:id/classify
POST /api/v1/leads/:id/stop
POST /api/v1/leads/:id/tag
POST /api/v1/monitor-replies/run
```

For now, Debra can rely on the app's existing inbox worker, Growth Center data, and database-backed reply classification.

## Deployment Notes

Before moving from local to Railway or another host:

- Set a public `PUBLIC_BASE_URL`.
- Confirm tracking URLs use the hosted domain.
- Confirm SQLite persistence/volume.
- Confirm SMTP/IMAP environment secrets.
- Confirm API token is not exposed publicly.
- Confirm sessions/cookies work on the hosted domain.
- Confirm inbox polling works from the hosted environment.

## Debra Operating Principles

Debra should:

- Create drafts first.
- Use descriptive campaign, segment, and label names.
- Preserve one campaign when only ICP copy changes.
- Use variants instead of duplicating campaigns.
- Respect warmup and mailbox limits.
- Surface risks before sending.
- Ask AJ before launching or making irreversible outreach changes.
