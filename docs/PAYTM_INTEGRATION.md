# How MITRA fits into Paytm

Paytm's financial services distribution earned ₹912 crore in Q2 FY27, up 49%, about 34% of operating revenue, driven by merchant loans, personal loans and Postpaid. That is where explanation pays for itself: fewer dropped KFS screens, fewer free-look cancellations, fewer complaints. We have not measured those. A pilot would.

## What is live today

| Surface | State | How to check |
|---|---|---|
| **Paytm MCP server** (official, beta) | MITRA reaches it, reads its OAuth metadata and registers as a client. Paytm's login page refused our automated browser, so **no tool has been called on a real account yet** | `GET /api/paytm/status`, or the Paytm tab |
| **Business profile from Paytm records** | Built and tested against a local stand-in for Paytm's server. It runs on a real account the moment a merchant signs in. Until then the demo shop uses labelled sample records in Paytm's format | `GET /api/paytm/profile`, `POST /api/paytm/sync`, `GET /api/paytm/profile?sample=1` |
| **UPI QR codes and links** | Works. Any `upi://` link is read and checked by Offer X-Ray: who really gets the money, and whether it has a merchant code | Paste one on a call, or use "Check a payment QR" |

The sign-in and tool code passes against a local stand-in for the same protocol (`test/paytm.test.js`), but that is not Paytm. To finish the MCP connection you need a Paytm merchant account. In a real browser, on this Mac: open the **Paytm** tab and click **Connect a Paytm merchant account**. It uses Paytm's own login (email, password, OTP). Then the same tab lists the tools and can create a real payment link.

## What MITRA reads from Paytm, and what it does with it

Only read tools are called. Each tool's published schema decides the arguments: date windows of at most 30 days (Paytm's limit for orders and refunds), page numbers and page sizes up to the tool's maximum. A tool that needs something MITRA cannot know, such as a merchant id, is skipped and named in the notes rather than guessed.

| Paytm tool | What it gives the profile |
|---|---|
| `fetch_all_orders` | Monthly sales from successful orders, ticket size, payment success rate, mix of UPI, cards and wallet, busy hours and days, repeat payers |
| `fetch_refunds` | Refund total and refund rate |
| `fetch_settlement_orders`, else `fetch_settlements_by_date` | Charges as a share of settled money, days to payout. Sales, if there is no order list |
| `fetch_payment_links` | Open links and the money still waiting on them |

From that the engine (`src/journeys/engines/paytmInsights.js`) gives:

- **A profile:** six full months of sales, this month so far, momentum, how even the months are, and who pays how.
- **A few words for the shop:** size band, growing, steady or slowing, even or uneven months, UPI-first, loyal regulars, busiest hours.
- **Suggestions, most urgent first:** failing payments, high refunds, sales falling month after month, whether six months of sales can back a working capital check (and whether the sample offer's daily repayment fits a usual day), unpaid links, slow months to plan for, dependence on a few payers, the rush hour, and what payments cost. Each one states the figures it rests on, and the thresholds are MITRA's own, labelled and dated.

On a call, "How is my business doing?" runs `merchant_insights` under its own consent purpose, `business_insights`. Working capital still asks for `merchant_credit` separately. When a shop is connected, its Paytm sales replace the sample summary in `merchant_sales_summary`, `merchant_eligibility` and the lender brief. If Paytm shows fewer than six full months, MITRA says so and shows no offer.

**Privacy.** Records are normalised before anything is stored, and each payer id is replaced by a keyed hash. The snapshot (`.data/paytm-snapshot.json`) is readable by its owner only, is refreshed after six hours or on request, and is deleted when the merchant disconnects. A month Paytm refused to return is never counted as a month with no sales: the order or settlement pull fails as a whole instead.

**What is not known yet.** Paytm does not publish its tools' response fields. The reader looks each field up under the names Paytm's APIs use (`txnAmount`, `TXNAMOUNT`, `txnAmount.value`, `resultInfo.resultStatus` and others) and reports which ones it found, so the first real sign-in will show at once whether anything was missed.

## What it would take to go further

| Surface | The change | Needs from Paytm |
|---|---|---|
| **The KFS step in a Paytm loan** | "Explain this in my language" beside the Key Fact Statement. MITRA gets the KFS as data, not a scan, and hands back to the same step | KFS data for the journey, and a slot in the flow |
| **Consumer and Business apps** | MITRA runs as a Mini App: a web URL with one-tap login | Onboarding. Microphone access inside the Mini App is the open question, as the public docs list camera and gallery APIs but not the microphone |
| **AI Soundbox** | Press, ask, hear. The Soundbox already speaks 11 Indian languages, and MITRA now speaks the same 11. Our screen is a simulator | A tool API from the device's assistant to MITRA's engines |
| **Merchant loans** | Eligibility from real orders and settlements is built (above). What is left is a real merchant sign-in, and the response fields confirmed | Merchant consent, and the data contract |
| **Paytm Intelligence** | The figures fence, voice check, receipts and Promise Check, as a trust layer for the banks, lenders and insurers Paytm is selling AI agents to | A conversation |

We found no public statement that Paytm uses Sarvam. Paytm's known AI partners are Groq and Perplexity. MITRA's router is one function, so it can run on whatever Paytm prefers, once the data-residency question is answered.

## The obvious question

**"Why would Paytm show a customer that the loan costs 17.7% and not 14%?"**

Because the lender already has to, in the Key Fact Statement. MITRA says it in words the customer understands, then hands back to the same step. It recommends no rival, and it never says "do not take this loan". The bet is that a customer who understands completes more often and complains less. We have not measured that, and the first pilot should.

## First pilot we would propose

- **Where:** the merchant loan flow, on the Business app, for one state and one language.
- **What:** an "Explain" button at the KFS step, and Karz Yatra as an option. Nothing else changes.
- **Measure, against a control group:** KFS-to-acceptance rate, cooling-off exits, complaints per thousand loans, and time on the step.
- **Guard rails:** a human review of the first 500 calls, and the voice check on every figure.
