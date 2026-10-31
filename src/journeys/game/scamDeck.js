// Scam Shield: real-looking requests, block or pay. The verdict and the reason come
// from the same Offer X-Ray engine the call uses, not from a second answer key.
import { checkPaymentRequest } from '../engines/payments.js';

export const SCAM_DECK = Object.freeze([
  { id: 'pm-loan', from: 'SMS, unknown number', text: 'Your PM Loan of ₹5,00,000 is approved. Pay ₹2,999 processing fee to pmloan.help@ybl within 2 hours to release it.', scam: true },
  { id: 'bill', from: 'Your saved biller, in your app', text: 'Your electricity bill of ₹1,240 is due on 5 Nov. Pay in the app from the saved biller.', scam: false },
  { id: 'refund-collect', from: 'UPI collect request', text: 'Paytm refund of ₹4,500 is waiting. Approve the collect request and enter your UPI PIN to receive it.', scam: true },
  { id: 'kyc', from: 'SMS, unknown number', text: 'Your KYC has expired and your account will be blocked today. Click this link and share the OTP to update it.', scam: true },
  { id: 'shop', from: 'At the counter', text: 'I scanned the shop QR at the kirana store to pay ₹320 for groceries I just bought.', scam: false },
  { id: 'lottery', from: 'WhatsApp, unknown number', text: 'Congratulations! You won ₹25,00,000 in a lucky draw. Send ₹5,000 tax today to claim your prize.', scam: true },
  { id: 'emi', from: 'Your lender, in your app', text: 'Your EMI of ₹9,603 is due on the 5th. Pay it from the loan section of your own app.', scam: false },
  { id: 'police', from: 'Phone call, unknown number', text: 'This is the cyber police. Your Aadhaar is linked to a crime. Stay on the call and transfer ₹50,000 to a safe account now or you will be arrested.', scam: true },
  { id: 'part-time', from: 'Telegram message', text: 'Earn ₹5,000 a day from home. Pay ₹999 registration today to start the part-time job.', scam: true },
  { id: 'friend', from: 'Your brother, in person', text: 'My brother is sitting next to me and asked me to send him ₹2,000 on his usual UPI ID for his bus ticket.', scam: false },
]);

export function gradeCard(card, blocked) {
  const check = checkPaymentRequest(card.text);
  const correct = blocked === card.scam;
  return { correct, scam: card.scam, verdict: check.verdict, score: check.score, why: check.flags[0]?.why || 'Nothing here asks for your PIN, a fee or a hurry, and you started this payment yourself.', flags: check.flags.map((flag) => flag.label) };
}

export function gradeDeck(answers) {
  const rows = SCAM_DECK.map((card, index) => ({ id: card.id, ...gradeCard(card, answers?.[index] === true), answered: answers?.[index] ?? null }));
  return { rows, correct: rows.filter((row) => row.correct && row.answered != null).length, total: rows.length };
}
