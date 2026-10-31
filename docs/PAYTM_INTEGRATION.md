# How MITRA fits into Paytm

Paytm's financial services distribution earned ₹912 crore in Q2 FY27, up 49%, about 34% of operating revenue, driven by merchant loans, personal loans and Postpaid. That is where explanation pays for itself: fewer dropped KFS screens, fewer free-look cancellations, fewer complaints. We have not measured those. A pilot would.

## What is live today

| Surface | State | How to check |
|---|---|---|
| **Paytm MCP server** (official, beta) | MITRA reaches it, reads its OAuth metadata and registers as a client. Paytm's login page refused our automated browser, so **no tool has been called yet** | `GET /api/paytm/status`, or the Paytm tab |
| **UPI QR codes and links** | Works. Any `upi://` link is read and checked by Offer X-Ray: who really gets the money, and whether it has a merchant code | Paste one on a call, or use "Check a payment QR" |

The sign-in and tool code passes against a local stand-in for the same protocol (`test/paytm.test.js`), but that is not Paytm. To finish the MCP connection you need a Paytm merchant account. In a real browser, on this Mac: open the **Paytm** tab and click **Connect a Paytm merchant account**. It uses Paytm's own login (email, password, OTP). Then the same tab lists the tools and can create a real payment link.

## What it would take to go further

| Surface | The change | Needs from Paytm |
|---|---|---|
| **The KFS step in a Paytm loan** | "Explain this in my language" beside the Key Fact Statement. MITRA gets the KFS as data, not a scan, and hands back to the same step | KFS data for the journey, and a slot in the flow |
| **Consumer and Business apps** | MITRA runs as a Mini App: a web URL with one-tap login | Onboarding. Microphone access inside the Mini App is the open question, as the public docs list camera and gallery APIs but not the microphone |
| **AI Soundbox** | Press, ask, hear. The Soundbox already speaks 11 Indian languages, and MITRA now speaks the same 11. Our screen is a simulator | A tool API from the device's assistant to MITRA's engines |
| **Merchant loans** | Eligibility from real settlements, through the MCP settlement tools, instead of a sample | Merchant consent, and the data contract |
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
