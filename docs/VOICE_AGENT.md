# The onboarding call

A Sarvam voice agent rings the customer's login number, asks a few questions, and the
answers come back to the app. Nothing it heard counts until the customer has checked it on
screen and said yes.

**In the app:** `server/agentCall.mjs` places the call (Instant Outbound API), takes the
result by webhook or by polling Sarvam analytics, and `src/journeys/ui/AgentCall.jsx` shows
it. With `PUBLIC_HOST` unset, polling alone works, about a minute after the call ends. The answers
are extracted after the call, so the screen says "writing up" until they arrive, for up to three minutes.

**The Sarvam MCP server** (`https://mcp.sarvam.ai/voice-agents`) is for setting the agent up
from Claude Code. It needs a browser sign-in and is not used by the running app.

## The flow

1. The customer signs up with a mobile number, or changes it under **Phone number and calls**
   in the account menu. Changing it needs the PIN, and it becomes the sign-in number too.
2. In onboarding, or from that same menu, they agree on screen and pick **Now** or **Later**.
3. The agent rings. It confirms who it is speaking to and asks only what the app does not have.
4. The answers come back. They appear in onboarding, or as a notice in the app if the customer
   has moved on. The customer corrects any line and chooses **Use these details** or discards them.
5. Confirmed answers fill the account (`work`, `city`, `lang`, `spoken`) and reach later calls.

## What is set up on Sarvam

| | |
| --- | --- |
| Agent | MITRA Onboarding Call, `MITRA-Onboa-29fbbab3-ec75`, version 2 |
| Calling from | The number in `SARVAM_AGENT_NUMBER`, on the connection in `SARVAM_CONNECTION_ID` |
| Languages | The eleven MITRA speaks; each call starts in the customer's chosen one |
| Limits | 7 minutes a call; 5 calls per account per day |

Everything except `SARVAM_AGENT_API_KEY` is in `.env`. Create that key under Settings, API Key in
the Voice Agents part of the Sarvam dashboard. Keys starting `sk_` are for the speech APIs, and Sarvam refuses
them here with "Invalid API key format". Then run `npm run check:call`,
which places no call, and restart the server.

To change the agent, edit it, commit a new version, and update `SARVAM_AGENT_APP_VERSION`. A running
app never picks up a draft.

## Variables

Sent with each call: `customer_name`, `preferred_language`, `work_known`, `city_known`.

Extracted from the transcript afterwards:

| Name | Type | Holds |
| --- | --- | --- |
| `work_type` | Enum: gig, shop, salaried, other | How the person earns |
| `city` | String | The city they named |
| `monthly_income` | String | Rupees as digits, such as 45000 |
| `dependants` | String | A single number |
| `existing_life_cover` | String | Rupees as digits, or `none` |
| `existing_health_cover` | String | Rupees as digits, or `none` |
| `main_goal` | String | What they most want help with |
| `call_outcome` | Enum | details_collected, partial_details, answers_doubtful, callback_requested, declined, wrong_person |

The prompt lives on Sarvam, not here, so there is only one copy to keep right.

## Unbelievable answers

Checked twice, because the agent can mishear and then trust itself. A real test turned "ninety" into 900.

**On the call:** the agent says a surprising figure back and asks again. After two confirmed surprising
answers it stops and asks whether these are the real details or whether the app would be easier. After
a third, it ends the call politely. It never accuses anyone.

**In the app** (`readAgentDetails`, whatever the agent concluded): a figure is left blank, with what was
heard shown beside it, when more than 12 people depend on the income, when monthly income is under
₹3,000 or over ₹10 lakh, or when a cover is over ₹5 crore or over 100 times yearly income. Two such
figures, or the outcome `answers_doubtful`, also put a warning above the form. The customer can still
type a real figure in. These limits are our own judgement, not a rule from a regulator.

## Not yet safe for real customers

The number is not proven to belong to the customer, because the app sends no SMS. Someone could enter
another person's number and have MITRA ring it. The agent says only the name on the account before the
person confirms who they are. Production needs an OTP on sign-up and on every number change.
