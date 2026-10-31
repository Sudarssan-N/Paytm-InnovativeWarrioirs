# MITRA in production: what is done and what is not

This is a working prototype with production habits. It is not in production, and this page says exactly how far it is.

## How a turn runs

```
Customer's voice ─ Saaras ─ Mayura ─ Safety rules ─ Sarvam-105B picks one allow-listed tool
                                                                 │
                         Deterministic engine, under consent, from a dated policy pack
                                                                 │
                         Fence: every figure must be one the engine computed
                                                                 │
                         Mayura ─ Fence: every figure must survive translation
                                                                 │
                         Bulbul speaks ─ Saaras hears it back ─ Hash-linked, signed receipt
```

**A model can route badly. It cannot put a rupee in a customer's ear that an engine did not compute.**

## When something fails

| Failure | What happens | Tested |
|---|---|---|
| The router model is down or slow | Topic rules and guided options, after 8 seconds at most | Yes, Model outage switch and test |
| A voice model stalls | First audio has a 6-second budget, then the device voice. A circuit breaker opens after 5 failures | Yes |
| A sentence can't be spoken on a phone call | The reply stops and says a person will call back. It never skips a figure | Yes, unit test |
| Translation changes a figure | Retried in two other styles, then that sentence stays in English | Yes, live |
| A sentence is dropped while splitting | Fixed. The whole reply is also checked as a second line of defence | Yes, unit test |
| Sarvam rate limit | Breaker and fallback. Sentence stays in English | Seen in testing |
| A document can't be read clearly | MITRA says which field, and will not guess | Yes, unit test |
| No Sarvam key at all | Engines and receipts still answer in English, and in Hindi where it is hand-written | Yes, production test |

## Load

`node scripts/loadcheck.mjs` starts its own server and writes `docs/evaluations/load-test.json`.

One Node process, engines, fences and receipts, with **no provider calls**:

| Concurrent callers | Turns a second | p50 | p95 | Errors |
|---:|---:|---:|---:|---:|
| 1 | 1,798 | under 1 ms | 1 ms | 0 |
| 10 | 4,247 | 1 ms | 3 ms | 0 |
| 50 | 4,407 | 8 ms | 18 ms | 0 |
| 200 | 4,542 | 31 ms | 57 ms | 0 |

Before batching saves, the same test gave about 40 turns a second, and 1.6 seconds at 50 callers. The real ceiling is the provider limits in [SARVAM_STACK.md](SARVAM_STACK.md), not this process.

## Security and privacy

| Control | State |
|---|---|
| Provider keys only on the server | Done |
| Content Security Policy and security headers, with a request id on every response | Done, checked in a browser with no violations |
| Forged `x-forwarded-for` can't dodge the rate limit | Done, tested |
| Logs hold the path only: a voice URL carries words in its query string | Done, `MITRA_LOG=json` |
| A customer's own words are never written to the disk cache | Done |
| Cache expires after 30 days, and is encrypted with `MITRA_CACHE_KEY` | Done |
| Uploaded documents and calls are not stored. Only a fingerprint and confirmed figures | Done |
| Erasure: one button removes the journey, and leaves a tombstone | Done, tested |
| Retention sweep after 30 days | Done |
| Consent per purpose, with an expiry, and withdrawal | Done |
| Staff token on the expert desk, `MITRA_DESK_TOKEN` | Done, unset in the demo |
| Paytm tools: read freely, and only a payment link may write, and only when confirmed. A refund can never run | Done, tested against a local stand-in for the protocol, not against a real account |

**Sarvam processes the audio and text.** A real deployment needs a data processing agreement with Sarvam, and written confirmation of where inference runs. Sarvam says its inference is India-hosted, and batch jobs ran in `ap-south-1` in our test, but we have not seen a contract.

## Not done

| Gap | Why it matters | What it takes |
|---|---|---|
| **No customer login** | Anyone with a session id can read it. Session ids are random, and that is all | Paytm's Mini App login, or OTP on the phone line |
| **The Paytm and metrics routes have no staff login** | Safe only because the server listens on localhost by default. Do not expose it as it is | Staff login before any public deployment |
| **Not tested with real people** | Questions and voices were synthetic. Noise, accents and real confusion are unmeasured | A pilot, with consent |
| **No native review of translations** | The fence protects figures, not meaning | A reviewer per language |
| **Sessions are in one process and one JSON file** | Does not survive more than one server | Postgres. The change sits in one function in `journeyApi.mjs` |
| **Rate limits and breakers are per process** | Would drift across servers | Redis |
| **Signing key is a file** | A stolen file could forge receipts | Move to an HSM or KMS |
| **No SMS** | Reminders are tracked, not sent | DLT templates and a provider |
| **No real phone number** | Bridge tested with a simulated caller on a real WebSocket | A number on a 1600-series or an inbound line |
| **Docker image not built here** | Docker is not on this machine | `docker build .` in CI |
| **Policy packs are ours** | They encode our reading of RBI and IRDAI rules | Legal review |

## Rules this has to live under

Only what we have checked. This is not legal advice.

- **RBI Digital Lending Directions, 2025.** The borrower must get a Key Fact Statement before the loan is finalised, and a lending service provider needs an agreement with the lender. MITRA explains the KFS and signs nothing, so the lender stays responsible.
- **TRAI 1600-series.** Service and transactional calls from RBI-regulated entities go on 1600 numbers, with DLT-registered content. So MITRA starts in the app and on inbound calls. Outbound AI calls are a separate compliance project.
- **IRDAI and DPDP.** The prototype follows the free-look and consent rules it encodes, but we have not had them reviewed.
