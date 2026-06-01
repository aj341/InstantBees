# Instant Bees API Instructions

Use this guide when creating or updating Instant Bees data through the local API.

## Base URL And Auth

Local API base:

```text
http://localhost:8080
```

API v1 base:

```text
http://localhost:8080/api/v1
```

Every `/api/v1/*` request needs:

```text
Authorization: Bearer <CLAUDE_API_KEY>
Content-Type: application/json
```

Example:

```bash
curl -X POST "http://localhost:8080/api/v1/campaign-packages" \
  -H "Authorization: Bearer <CLAUDE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d @campaign-package.json
```

## Campaign Package Upload

Use this endpoint to create templates, segments/lists, contacts, campaigns, sequence steps, ICP variants, and attachments in one upload:

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

Campaigns created through this endpoint are created as drafts. Launch them later from the app after checking them.

## Templates

Templates are reusable email bodies. Campaign steps can reference them by `templateName`.

```json
{
  "templates": [
    {
      "name": "C1 Step 1",
      "subject": "Quick one for {{company}}",
      "previewText": "A quick idea for {{company}}",
      "body": "Hi {{firstName}},\n\nEmail copy here...",
      "bodyType": "text",
      "attachments": []
    }
  ]
}
```

Supported merge fields:

```text
{{firstName}}
{{lastName}}
{{company}}
{{title}}
{{role_title}}
{{roleTitle}}
{{email}}
{{linkedinUrl}}
{{customFields.hook}}
{{customFields.linkedinPostRef}}
{{hook}}
```

Custom fields can be referenced with either nested syntax (`{{customFields.hook}}`) or flat syntax (`{{hook}}`). Missing merge fields render as an empty string. For `bodyType: "html"`, merge values are HTML-escaped before sending.

Field meanings:

```text
{{title}}      = the lead's own job title
{{role_title}} = the role/job/opportunity being emailed about
```

Recommended default:

```json
"bodyType": "text"
```

Use `"html"` only when the email needs designed HTML.

## Segments, Labels, And Contacts

Segments create lead lists. Labels are used for ICP variants and filtering.

Draft segment with no contacts:

```json
{
  "segments": [
    {
      "name": "C1 Fractional CMO Segment",
      "labelNames": ["C1-FractionalCMO"],
      "contacts": []
    }
  ]
}
```

Segment with contacts:

```json
{
  "segments": [
    {
      "name": "C1 Fractional CMO Segment",
      "labelNames": ["C1-FractionalCMO"],
      "contacts": [
        {
          "email": "alex@example.com",
          "firstName": "Alex",
          "lastName": "Smith",
          "company": "Acme",
          "title": "Founder",
          "roleTitle": "Senior Designer",
          "website": "https://example.com",
          "phone": "",
          "linkedinUrl": "https://www.linkedin.com/in/alex-smith-12345/",
          "customFields": {
            "hook": "appears your team is the marketing function for three brands at once",
            "linkedinPostRef": "your post on retention last week"
          }
        }
      ],
      "onDuplicate": "skip"
    }
  ]
}
```

CSV segment upload:

```json
{
  "segments": [
    {
      "name": "Agency Leads",
      "labelNames": ["Agency"],
      "csvText": "email,firstName,lastName,company,title,role_title,website,linkedinUrl,hook\nalex@example.com,Alex,Smith,Acme,Founder,Senior Designer,https://example.com,https://www.linkedin.com/in/alex-smith-12345/,appears your team is growing fast"
    }
  ]
}
```

CSV columns that are not standard contact fields become custom fields automatically. For example, a `hook` CSV column becomes `{{hook}}` and `{{customFields.hook}}`.

## Add Contacts To An Existing Segment

Use this endpoint to append or top up contacts in an existing segment/list:

```text
POST /api/v1/segments/:id/contacts
```

Alias:

```text
POST /api/v1/lists/:id/contacts
```

JSON body:

```json
{
  "contacts": [
    {
      "email": "alex@acme.com",
      "firstName": "Alex",
      "company": "Acme",
      "roleTitle": "Senior Designer",
      "linkedinUrl": "https://www.linkedin.com/in/alex-smith-12345/",
      "customFields": {
        "hook": "appears your team is the marketing function for three brands at once",
        "linkedinPostRef": "your post on retention last week"
      }
    }
  ],
  "labelIds": [1, 2],
  "onDuplicate": "update"
}
```

CSV body:

```json
{
  "csvText": "email,firstName,company,role_title,linkedinUrl,hook\nalex@acme.com,Alex,Acme,Senior Designer,https://www.linkedin.com/in/alex-smith-12345/,appears your team is growing fast",
  "onDuplicate": "skip"
}
```

Response shape:

```json
{
  "total": 1,
  "created": 1,
  "updated": 0,
  "skipped": 0,
  "failed": 0,
  "added": 1,
  "leadIds": [123],
  "createdIds": [123],
  "updatedIds": [],
  "skippedContacts": [],
  "failures": [],
  "labelsApplied": 0
}
```

## Contact Idempotency

Duplicate matching is by email address globally, not email plus segment.

Default behaviour:

```json
"onDuplicate": "skip"
```

Allowed duplicate modes:

```text
skip   = preserve existing contact fields, still attach the contact to the segment, return it under skippedContacts
update = update non-empty standard fields, merge customFields, attach the contact to the segment
error  = do not attach or update the duplicate, return it under failures
```

Update rules:

```text
Standard fields overwrite only when the incoming value is non-empty.
Existing standard fields are preserved when the incoming value is missing or blank.
customFields are merged, with incoming keys overriding existing keys of the same name.
linkedinUrl and roleTitle behave like standard fields.
```

Label naming recommendation:

```text
Use descriptive names like C1-FractionalCMO, not just C1.
```

## Campaigns

Campaigns reference segments through `segmentName`.

```json
{
  "campaigns": [
    {
      "name": "C1 Fractional CMO Campaign",
      "segmentName": "C1 Fractional CMO Segment",
      "fromName": "AJ Kavanagh",
      "replyTo": "aj@designbees.com.au",
      "dailyLimit": 80,
      "batchSize": 5,
      "batchIntervalMinutes": 60,
      "sendWindowStart": "07:00",
      "sendWindowEnd": "19:00",
      "sendWindowTimezone": "Australia/Sydney",
      "sendWindowDays": "mon,tue,wed,thu,fri",
      "trackOpens": true,
      "trackClicks": true,
      "includeUnsubscribe": true,
      "steps": []
    }
  ]
}
```

Mailbox routing:

```text
Do not send mailboxIds.
Instant Bees auto-rotates across all enabled/sendable mailboxes.
```

Send window:

```text
Campaign-level fields:
sendWindowStart: "07:00"
sendWindowEnd: "19:00"
sendWindowTimezone: "Australia/Sydney"
sendWindowDays: "mon,tue,wed,thu,fri"
```

Cadence:

```text
batchSize: 5
batchIntervalMinutes: 60
dailyLimit: 80
```

`dailyLimit` is a campaign cap. Mailbox warmup and mailbox daily limits can still reduce actual sending volume.

## Sequence Steps

Steps live inside each campaign.

```json
{
  "steps": [
    {
      "subject": "Quick one for {{company}}",
      "previewText": "A quick idea for {{company}}",
      "body": "Hi {{firstName}},\n\nStep 1 copy here...",
      "bodyType": "text",
      "delayDays": 0
    },
    {
      "subject": "Worth a look?",
      "body": "Hi {{firstName}},\n\nStep 2 copy here...",
      "bodyType": "text",
      "delayDays": 2
    }
  ]
}
```

Delay rule:

```text
delayDays is relative to the previous step.
```

Step 1 should usually use:

```json
"delayDays": 0
```

Step using a template:

```json
{
  "templateName": "C1 Step 1",
  "delayDays": 0
}
```

## ICP / Label-Based Variants

Use variants when one step changes based on the lead's label, but the campaign remains the same.

```json
{
  "steps": [
    {
      "subject": "Default subject",
      "body": "Default copy for leads without a matching variant.",
      "bodyType": "text",
      "delayDays": 0,
      "variants": [
        {
          "labelName": "C1-FractionalCMO",
          "subject": "Fractional CMO subject",
          "body": "Fractional CMO copy here...",
          "bodyType": "text",
          "priority": 10
        },
        {
          "labelName": "C2-Founder",
          "templateName": "C2 Founder Step 1",
          "name": "Founder variant",
          "priority": 10
        }
      ]
    }
  ]
}
```

Variant rules:

```text
If lead has matching label, that variant is sent.
If no label matches, default step content is sent.
If multiple labels match, highest priority wins.
```

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

Plain text attachment:

```json
{
  "attachments": [
    {
      "filename": "notes.txt",
      "content": "Attachment text here",
      "contentType": "text/plain"
    }
  ]
}
```

Attachment limits:

```text
Maximum 10 attachments per email object.
Prefer small files. Large attachments hurt deliverability.
Where possible, use a link instead of attaching large files.
```

## Full Example

```json
{
  "templates": [
    {
      "name": "C1 Fractional CMO Step 1",
      "subject": "Quick one for {{company}}",
      "body": "Hi {{firstName}},\n\nI had an idea for {{company}}...",
      "bodyType": "text"
    }
  ],
  "segments": [
    {
      "name": "C1 Fractional CMO Segment",
      "labelNames": ["C1-FractionalCMO"],
      "contacts": []
    }
  ],
  "campaigns": [
    {
      "name": "C1 Fractional CMO Campaign",
      "segmentName": "C1 Fractional CMO Segment",
      "fromName": "AJ Kavanagh",
      "replyTo": "aj@designbees.com.au",
      "dailyLimit": 80,
      "batchSize": 5,
      "batchIntervalMinutes": 60,
      "sendWindowStart": "07:00",
      "sendWindowEnd": "19:00",
      "sendWindowTimezone": "Australia/Sydney",
      "sendWindowDays": "mon,tue,wed,thu,fri",
      "steps": [
        {
          "templateName": "C1 Fractional CMO Step 1",
          "delayDays": 0
        },
        {
          "subject": "Worth a quick look?",
          "body": "Hi {{firstName}},\n\nJust floating this back up...",
          "bodyType": "text",
          "delayDays": 2,
          "variants": [
            {
              "labelName": "C1-FractionalCMO",
              "subject": "Worth a quick look for {{company}}?",
              "body": "Hi {{firstName}},\n\nFractional CMO follow-up copy...",
              "bodyType": "text",
              "priority": 10
            }
          ]
        }
      ]
    }
  ]
}
```

## Mailbox Bulk Import

Endpoint:

```text
POST /api/v1/mailboxes/bulk
```

JSON example:

```json
{
  "accounts": [
    {
      "email": "aj@designbees.com.au",
      "name": "AJ Kavanagh",
      "provider": "gmail",
      "smtpUsername": "aj@designbees.com.au",
      "smtpPassword": "app-password",
      "dailySendLimit": 40,
      "warmupEnabled": false
    }
  ]
}
```

CSV example:

```json
{
  "csvText": "email,name,provider,smtpUsername,smtpPassword,dailySendLimit,warmupEnabled\naj@designbees.com.au,AJ Kavanagh,gmail,aj@designbees.com.au,app-password,40,false"
}
```

## Mailbox Limits

Endpoint:

```text
PATCH /api/v1/mailboxes/:id/limits
```

Example:

```json
{
  "dailySendLimit": 30,
  "warmupEnabled": true
}
```

Warmup schedule:

```text
Days 1-3: 5/day
Days 4-7: 10/day
Days 8-12: 15/day
Days 13-17: 20/day
Days 18-21: 25/day
Days 22+: 30/day, capped by mailbox dailySendLimit
```

## Useful GET Endpoints

```text
GET /api/v1/campaigns
GET /api/v1/campaigns/:id
GET /api/v1/templates
GET /api/v1/mailboxes
GET /api/v1/contacts
```

## Common Mistakes To Avoid

```text
Do not send mailboxIds in campaigns.
Do not create separate campaigns just for one ICP step variant.
Do not use bodyType html unless HTML is actually required.
Do not use vague labels like C1 when C1-FractionalCMO is available.
Do not put send-window settings globally; they belong on each campaign.
Do not launch automatically after package upload. Review drafts first.
```
