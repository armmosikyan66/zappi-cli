---
type: command
tags: [cli, invite]
updated: 2026-09-22
---

# invite

Recommend Zappi. Prints the Nest invite URL for this pot. Does not invent a code.

```bash
zappi-cli invite [--json]
```

Any extra argument throws `INVITE_LINK_MISSING` with `Usage: zappi-cli invite [--json]. Set ZAPPI_POT_ID. Do not pass an invite code.`

## Request

`GET /api/invite/pots/<ZAPPI_POT_ID>/link`. No session cookie and no pot key. `ZAPPI_POT_ID` must be a UUID. Paywall base is the same resolver as [[commands/pay]].

Fail closed:

| Code | When |
| --- | --- |
| `INVITE_AFFILIATE_DISABLED` | Nest says the affiliate flag is off. |
| `INVITE_LINK_MISSING` | No URL/path, or the path is not `/invite/…`. |
| `RATE_LIMITED` | Nest rate-limits the lookup. |

If Nest returns a path because the app URL is unset, the CLI qualifies it with `ZAPPI_APP_ORIGIN` (default `https://zappi.money`). It does not add query params.

## Output

Pretty and plain print `inviteUrl`. JSON: `{ ok, command: "invite", inviteUrl, sharePath }`.
