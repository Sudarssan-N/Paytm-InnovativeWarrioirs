# How MITRA uses Sarvam

Every number here was measured on the live API on 31 October 2026, on the pay-as-you-go plan, from Bengaluru. Rerun with `npm run preflight`, `scripts/voice-fence.mjs` and `scripts/eval-router.mjs`.

| Sarvam product | What MITRA does with it | Measured |
|---|---|---|
| **Saaras v4**, REST, with key terms | Hears the customer. Detects the language. Expects EMI, APR, KFS and UPI. | Reads spoken "chaudah pratishat" as 14%, where v3 left it in words |
| **Saaras**, translate mode | Hears MITRA's own voice back, to check every figure was spoken right | 75 of 77 hard sentences across 11 languages |
| **Saaras batch**, with speaker separation | Promise Check: who said what on a recorded sales call | 40-second call in about 4 to 5 seconds |
| **Saaras streaming** (`/speech-to-text/ws`), 8 kHz | Ready for the phone line. Sarvam's VAD ends the turn | Transcript 0.09 s after end of speech. Not yet wired in |
| **Bulbul v3**, HTTP streaming | MITRA's voice in the app and on the phone line | First audio in about 200 ms, against 1.8 s over REST |
| **Bulbul v3**, 8 kHz mu-law | Phone audio, with no conversion on our side | Works, first audio about 190 ms |
| **Bulbul v4 Flash** | Tested as the cheaper voice: ₹10 against ₹30 per 10,000 characters | Same Kannada and APR faults. Not switched yet |
| **Mayura** | Translates every reply, behind the figures fence, in 10 Indian languages | `classic-colloquial` first. 0 sentences rejected in the demo set |
| **Sarvam Translate** | Answers on screen in languages Bulbul does not speak | Tested typed: Urdu, and Manipuri with the fence rejecting 2 sentences |
| **Language identification** | Tells Hindi from Marathi, and romanised Indian text from English | Used on typed text only |
| **Transliteration** | Roman captions for people who read their language slowly | `Aapki EMI ₹9,603 hai.` |
| **Sarvam Vision** (Document AI) | Reads the customer's own KFS, PDF or photo, with a confidence and a page for each field | 11 fields in about 4.5 s. Every field right on the sample |
| **Sarvam-105B Conversations** | Routes each turn to one allow-listed tool | 89% right on 155 blind questions, median 166 ms. The whole pipeline: 88% right, 6% safe miss, 6% wrong on 192, median 1.39 s a turn |
| **Sarvam-105B Conversations** | A second opinion on scams, and finding promises on a call | 6 of 6 scams on the test deck, 1 false alarm on 4 normal messages, now only a caution |

DeepSeek is no longer on the path of any customer's words. It stays available behind `MITRA_ROUTER=deepseek`.

## Faults we found, and what we did

These are why the voice check exists. The text fence passed every one of them, because the text was right.

| Fault | Where | Fix |
|---|---|---|
| "APR 17.7%" spoken as "17 April, 7 percent" | Hindi, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Bengali, Odia, Punjabi, on v3, and on v4 in Hindi and Kannada | Write it as "A P R" for the voice |
| Tens dropped from Kannada figures: ₹590 as 500, ₹93,750 as 93,700 | Kannada, every voice, v3 and v4 | Spell figures in English words for the voice |
| Hearing loses a lakh when translating: ₹2,00,291 as 291 | Saaras translate mode in Tamil, Telugu, Malayalam, Punjabi. The speech itself is right | A figure is only doubted if the native transcript also misses it |
| `sarvam-105b` with a low token limit answers almost nothing | Reasoning uses the budget: 48% at 200 tokens | Use `sarvam-105b-conversations` for routing |

**Worth telling Sarvam:** the first two look like number and abbreviation normalisation in Bulbul.

## What would make it better

1. **Saaras streaming on the phone line.** Replaces our energy-threshold end-of-turn detection, which a noisy shop will defeat. Default VAD ends the turn well. `high_vad_sensitivity` splits sentences mid-way, so it needs its own endpointing.
2. **Bulbul v4 Flash,** once `scripts/voice-fence.mjs` passes on it. It cuts the voice bill by two thirds.
3. **A pronunciation dictionary** (`dict_id`), to replace the text rewriting above.
4. **Sarvam Vision for claim letters and policies,** so the claim journey works on a customer's real papers, as the loan journey now does.

## What we chose not to use

- **Voice Agents (Samvaad),** at least for now. The figures fence has to sit between the model and the voice, and its documentation does not show a way to do that.
- **Voice cloning.** A financial assistant that sounds like someone it is not is the wrong kind of trust.

## Limits to plan for

| Limit | Pay as you go | Growth | What it means |
|---|---|---|---|
| Translation | 60 a minute | 1,000 a minute | A turn is about 5 calls, so about 4 live callers, or about 65 on Growth, before caching |
| Speech to text, streaming | 20 at once | 100 at once | Hard ceiling on live phone calls per account |
| Text to speech, WebSocket | 60 at once | 1,000 at once | |

We hit the 60-a-minute limit while testing, and a circuit breaker and rule fallback took over. National scale needs an enterprise plan, or self-hosting on AWS. The self-hosted listing has Saaras, Bulbul and Vision, but its page does not list text translation or chat, so that gap needs a conversation with Sarvam.

**Estimated cost of a 3-minute call,** at list prices, 6 turns of about 180 characters: translation about ₹3.20, voice about ₹3.70, hearing about ₹1.50. About **₹8.40**, or ₹2.80 a minute, before telephony. Bulbul v4 Flash would bring it to about ₹6. Sarvam Voice Agents start at ₹3 a minute.
