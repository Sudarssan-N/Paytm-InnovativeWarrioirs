# MITRA: one AI agent for every financial journey

Paytm Build for India AI Hackathon, Bengaluru 2026. Track 2: AI-Powered Financial Journeys.
Team Innovative Warriors: Sudarssan N, Jeyaanth A.

Insurance, loans and payments, explained on a call in the customer's own language, with a signed record of every rupee. **Prototype on synthetic data. MITRA explains; it never signs or pays.**

```bash
npm ci
cp .env.example .env     # add SARVAM_API_KEY
npm run build
npm start                # http://127.0.0.1:8787
npm test
npm run warm             # stores the demo's speech, so it plays instantly and offline
npm run preflight        # checks every stage on the real services
```

## What happens on one turn

1. **Hear.** Saaras transcribes and detects the language. Mayura translates to English.
2. **Route.** Safety rules first, for a scam, someone in trouble or a request for a person. A model places everything else, and rules take over if it is down. Either way it is one allow-listed tool, schema-checked. No tool takes a number.
3. **Compute.** A deterministic engine reads the KFS and a dated policy pack. Agents read facts only through `readFact`, under consent for that purpose.
4. **Check.** A reply stating a figure the engine did not compute is blocked (`assertGrounded`).
5. **Translate.** Every figure must survive. A sentence that changes one is retried in other styles, then left in English (`translateFenced`).
6. **Hear it back.** Bulbul speaks, and Saaras listens to that audio. Every figure must be heard as written (`verifySpeech`).
7. **Seal.** What was asked, said and computed goes into a SHA-256 linked, Ed25519-signed Journey Passport.

## Beyond the call

| Feature | What it does | Built on |
|---|---|---|
| **Loan Clarity** | Reads bank statements, UPI receipts and ITR or GST returns, adds up every income stream, and counts weak months, so the EMI fits a slow month. Every line is shown back to untick or correct. Sliders show each month's cash flow under any amount and term | Sarvam Vision, deterministic income engine |
| **Read my loan papers** | Reads a customer's own KFS, as a PDF or a photo, reads it back, and checks the lender's arithmetic | Sarvam Vision |
| **Promise Check** | Compares what an agent said on a recorded call with what the paper says, quote by quote | Saaras batch, Sarvam-105B |
| **Karz Yatra** | A 2D game of the customer's own loan. EMI split, APR, bounces, prepaying, cover and scams | The same engines as the call |
| **Scam Shield, Claim Detective** | Two more games, on Offer X-Ray and on claim deductions | The same engines as the call |
| **Understanding receipt** | A graded check after each game, sealed on the Passport. It blocks nothing | Server-side grading |
| **Offer X-Ray for UPI** | Reads any `upi://` link or QR: who really gets the money | Deterministic |
| **Soundbox simulator** | Payment announcements and press-to-ask, for a shopkeeper | Bulbul, Saaras |
| **Paytm link** | OAuth to Paytm's hosted MCP server, with token refresh. Real payment links | Paytm MCP. Sign-in pending |
| **Business profile from Paytm** | Reads six months of orders, refunds, settlements and payment links through the MCP read tools. Profiles the shop and suggests what to look at: failing payments, refunds, falling sales, working capital, unpaid links, the rush hour. Live sales replace the sample in the merchant journey | Paytm MCP, deterministic insights engine |
| **Ops tab** | Latency, estimated cost per turn, fence counts and circuit breakers | `/api/ops/metrics` |

Details: [how each Sarvam product is used and measured](docs/SARVAM_STACK.md), [what production needs](docs/PRODUCTION.md), [how it fits Paytm](docs/PAYTM_INTEGRATION.md).

## Five journeys

| Journey | Agent | Tools |
|---|---|---|
| Understand a loan | Lending | `explain_loan_offer`, `check_affordability`, `simulate_terms`, `foreclosure_question`, `prepay_vs_invest`, `cooling_off_status`, `record_loan_decision`, `mark_loan_signed` |
| Buy the right cover | Insurance | `protection_gap`, `explain_plans`, `free_look_status` |
| File a claim | Claims | `claim_checklist`, `mark_claim_documents`, `explain_claim_deductions`, `draft_grievance` |
| Catch a scam before the PIN | Payment safety | `check_payment_request` |
| Working capital on the Soundbox | Merchant | `merchant_sales_summary`, `merchant_insights`, `merchant_eligibility`, `send_lender_brief` |

Across all of them: onboarding asks for a fact once and consent per purpose, and a person takes over with a ready brief when asked, on a dispute, on a hard-to-undo step, on signs of distress, or when MITRA is unsure.

## Where things are

| Path | What it is |
|---|---|
| `src/journeys/engines/` | Deterministic engines. Same input, same rupees |
| `src/journeys/policyPacks.js` | Dated rules and labelled assumptions |
| `src/journeys/tools.js` | The allow-list: each tool's agent, needs and reply |
| `src/journeys/router.js` | Rules, then the model |
| `src/journeys/orchestrator.js` | One turn: pending questions, consent, handoffs |
| `src/journeys/consent.js`, `passport.js`, `money.js` | Consent, the chain, and the figures fence |
| `src/journeys/ui/` | The web app |
| `server/journeyApi.mjs` | Turn, verify and expert-desk API |
| `src/journeys/voiceFence.js` | What the voice is given, and the spoken-figure check |
| `src/journeys/game/`, `src/journeys/ui/LoanGame.jsx`, `karzPaint.js` | The games: rules without a DOM, then the canvas |
| `src/journeys/engines/income.js`, `incomeRead.js`, `ui/LoanClarity.jsx` | Loan Clarity: income from papers, affordability, the terms simulator. Samples: `node scripts/make-income-samples.mjs` |
| `src/journeys/documentRead.js`, `engines/promises.js` | Reading a KFS, and checking promises |
| `server/sarvamServer.mjs` | Sarvam calls and the translation fence |
| `server/voiceStream.mjs` | Streaming voice and the voice check |
| `server/documents.mjs`, `server/callCheck.mjs` | Sarvam Vision and Saaras batch |
| `server/paytm.mjs` | OAuth and MCP client for Paytm's hosted server |
| `server/paytmProfile.mjs`, `engines/paytmInsights.js` | Pulling a merchant's records through MCP, and the profile and suggestions made from them. Sample: `samplePaytm.js` |
| `server/ops.mjs` | Metrics, cost estimate and circuit breakers |
| `server/telephony.mjs` | Phone bridge for Twilio media streams |
| `src/engine/`, `src/components/` | The voice stack and the avatar |

## Known limits

- All customers, offers, plans and policy wordings are synthetic.
- The phone bridge has been tested with a simulated caller, not on a real carrier.
- Reminders are tracked and shown. No SMS is sent.
- The figures fence protects numbers, not meaning. Translations need native review.
- In a test of 192 customer questions, written by a model and now run more than once, a few still reached the wrong tool. See `docs/evaluations/`.
- Nothing has been tested with real customers, and the voices in every test were synthetic.
- No Paytm tool has been called on a real account yet: it needs a merchant sign-in. The business profile is tested against a local stand-in, and Paytm does not publish its response fields.
- Rule details come from published summaries, not a legal review.
- There is no customer login, the expert desk's staff token is off in the demo, and the signing key is a local file. See [docs/PRODUCTION.md](docs/PRODUCTION.md).
