// Payment safety engine: Offer X-Ray. Checks a request, forward or offer before
// the PIN screen and says, in plain words, which red flags it found and why.
// Rule based on purpose: the verdict must not depend on a model being up.
import { PACKS, packStamp } from '../policyPacks.js';

const SIGNALS = [
  { id: 'pin_to_receive', hard: true, weight: 70, label: 'Asks for your PIN to receive money',
    re: /\b(enter|share|put|give|type|use)\b.{0,30}\bpin\b.{0,50}\b(receive|get|credit|refund|cashback|claim|prize)\b|\b(receive|refund|cashback|prize|credited|get)\b.{0,50}\b(enter|share|put|type)\b.{0,30}\bpin\b/i,
    why: 'Your UPI PIN only ever sends money out. You never need it to receive money.' },
  { id: 'otp_share', hard: true, weight: 70, label: 'Asks you to share an OTP or password',
    re: /\b(share|tell|send|give|read out|asking|asked|asks|wants?|needs?|requesting)\b.{0,25}\b(otp|one[- ]time password|cvv|password|pin)\b|\b(otp|cvv)\b.{0,30}\b(give|share|tell|send|asking|asked|should)\b/i,
    why: 'No bank, lender or app staff needs your OTP, CVV or password.' },
  { id: 'upfront_fee', hard: true, weight: 60, label: 'Wants a fee before releasing a loan',
    re: /\bpay\b.{0,50}\b(processing|registration|file|advance|token|insurance|gst)\b.{0,15}\b(fee|charge|charges|amount)\b|\b(processing|registration|file|advance|token)\b.{0,12}\b(fee|charge|charges)\b.{0,60}\b(pay|send|deposit|transfer|upi|release|disburse)\b/i,
    why: 'A real lender takes its fee from the loan or through its own account. It does not ask you for money first to release a loan.' },
  { id: 'loan_fee_first', hard: true, weight: 60, label: 'Says a loan is approved, then asks for money',
    re: /(?=[\s\S]*\b(approved|sanctioned|pre-?approved|disburs\w*)\b)(?=[\s\S]*\b(pay|paid|fee|fees|charges?|deposit|instal\w*|advance)\b)[\s\S]*\b(loan|lon|karz)\b/i,
    why: 'A real lender takes its fee from the loan or through its own account. It does not ask you for money first to release a loan.' },
  { id: 'bank_details', hard: true, weight: 60, label: 'Asks for your bank or card details',
    re: /\b(asking|asked|asks|wants?|needs?|give|share|send|tell)\b.{0,30}\b(bank|account|aadhaa?r|pan|card|debit|credit|net ?banking)\b/i,
    why: 'A stranger with those details can take your money or open a loan in your name.' },
  { id: 'digital_arrest', hard: true, weight: 70, label: 'Threatens arrest or a legal case',
    re: /\b(digital arrest|arrest warrant|money laundering|narcotics|will be arrested|safe account)\b|\bparcel\b.{0,40}\b(seized|customs|illegal)\b|\b(police|cbi|customs|crime branch)\b.{0,70}\b(arrest\w*|case|crime|warrant)\b|\baadhaa?r\b.{0,40}\b(crime|case)\b/i,
    why: 'Police and courts do not arrest anyone by video call or collect money over UPI.' },
  { id: 'task_job', hard: true, weight: 60, label: 'Asks you to pay to get a job or earn money',
    re: /\b(earn|part[- ]?time|work from home|home based|online tasks?|data entry)\b.{0,80}\b(pay|deposit|registration|invest)\b|\b(pay|deposit|registration)\b.{0,60}\b(part[- ]?time|work from home|online tasks?|job offer|to earn)\b/i,
    why: 'A real job pays you. It never asks you to pay first, and task scams grow with every small payment.' },
  { id: 'remote_app', hard: true, weight: 60, label: 'Asks you to install an app or share your screen',
    re: /\b(anydesk|teamviewer|quick ?support|screen ?share|share your screen|\.apk|apk file)\b|\binstall\b.{0,20}\bapp\b.{0,30}\b(link|support|verify|kyc)\b/i,
    why: 'Screen-sharing apps let the caller watch your PIN and OTP as you type them.' },
  { id: 'kyc_threat', hard: true, weight: 60, label: 'Pushes a KYC update or threatens your account',
    re: /\bkyc\b.{0,80}\b(expir\w*|deadline|update|updating|complete|block\w*|suspend\w*|link|click)\b|\b(link|click|update|expir\w*)\b.{0,60}\bkyc\b|\b(account|wallet|sim|bank)\b.{0,30}\b(will be |is |be )?(block|blocked|suspend|suspended|closed|deactivated)\b/i,
    why: 'Fear of losing your account is how people are rushed into paying. Check inside your own app, not from a message.' },
  { id: 'lottery', weight: 55, label: 'Says you have won a prize',
    re: /\b(lottery|lucky draw|(you|i|he|she|we) (have |has )?(won|win)|winning|prize|kbc|jackpot)\b/i,
    why: 'A prize you did not enter for is the opening line of a common scam.' },
  { id: 'collect', weight: 30, label: 'A collect request, not a payment to you',
    re: /\b(collect request|payment request|approve the request|approve request|approve the collect)\b/i,
    why: 'Approving a collect request takes money out of your account. It never puts money in.' },
  { id: 'guarantee', weight: 25, label: 'Promises what no one can promise',
    re: /\b(guaranteed|assured returns?|risk[- ]free|double your|100% approv\w*|no (documents?|cibil|credit check))\b/i,
    why: 'Real loans depend on your credit. Real investments carry risk.' },
  { id: 'impersonation', weight: 25, label: 'Uses a government or company name',
    re: /\b(rbi|reserve bank|government|pm loan|pradhan mantri|npci|cbi|income tax|customs|paytm (support|team|care|refund)|bank (manager|officer))\b/i,
    why: 'Scammers borrow trusted names. The name in a message proves nothing.' },
  { id: 'personal_upi', weight: 25, label: 'Payment goes to a personal UPI ID',
    re: /\b[\w.-]+@(ybl|okaxis|oksbi|okhdfcbank|okicici|paytm|ptyes|ptsbi|axl|ibl|upi)\b/i,
    why: 'Companies collect through verified merchant accounts, not a personal-looking ID.' },
  { id: 'urgency', weight: 20, label: 'Rushes you to act',
    re: /\b(urgent|urgently|immediately|within \d+ (hours?|hrs?|minutes?|mins?)|today only|last chance|expires? (today|soon)|limited time|right now)\b/i,
    why: 'Pressure is there so that you do not stop and check.' },
  { id: 'link', weight: 25, label: 'Sends you to an unknown link',
    re: /\b(bit\.ly|tinyurl|t\.co|wa\.me)\b|\.(xyz|top|click)\b|\bclick\b.{0,20}\blink\b|\blink\b.{0,20}\b(click|open|update)\b/i,
    why: 'Short or unfamiliar links can open a fake payment page.' },
];

const UNPROMPTED = /\b(message|sms|text|call|called|phoned|number|whatsapp|someone|somebody|a (man|woman|person|lady)|stranger|unknown number|(got|received|came|arrived|getting) .{0,12}(call|message|sms|mail|email|whatsapp)|(call|message|sms|mail|email)\b.{0,20}(came|arrived|saying|said|says)|(they|he|she) (said|says|told|called)|called me|call me|forward\w*)\b/i;

// "Is this a scam?" with no message is a request to see it, not a clean result.
// Reporting "no red flags" here would reassure someone about a message never checked.
export const isOnlyAsking = (text) => String(text || '').trim().length < 90
  && /\b(this|a|the|that|some|one|any)\b.{0,12}\b(message|sms|offer|call|link|request|forward|text|mail|email)\b|\b(check|scam|fraud|fake|genuine|real)\b/i.test(text)
  && !/\d/.test(text);

export const RISK_LEVELS = ['likely_scam', 'unsure', 'looks_normal'];

// A UPI link is what any payment QR holds. It says who really gets the money.
export function readUpiLink(text) {
  const found = String(text || '').match(/upi:\/\/(pay|mandate)\?[^\s"'<>]+/i);
  if (!found) return null;
  let params;
  try { params = new URL(found[0]).searchParams; } catch { return null; }
  const payee = params.get('pa') || '', name = params.get('pn') || '', amount = params.get('am') || '', note = params.get('tn') || '', code = params.get('mc') || '';
  if (!payee) return null;
  const merchant = /^\d{4}$/.test(code) && code !== '0000';
  return {
    payee, name, amount: amount ? Number(amount) : null, note, merchant, mandate: found[1].toLowerCase() === 'mandate',
    summary: `Payment to ${name || 'an unnamed payee'} at ${payee}${amount ? ` for rupees ${amount}` : ''}${note ? `. Note: ${note}` : ''}.`,
  };
}

// `modelRisk` is a second opinion that only works one way. Rules cannot foresee every
// new scam, so a model may raise the alarm. It can never lower one, so a confused or
// manipulated model cannot talk MITRA into calling a scam safe.
export function checkPaymentRequest(text, { modelRisk = null } = {}) {
  const pack = PACKS.payments;
  const upi = readUpiLink(text);
  const value = upi ? `${upi.summary}\n${String(text || '')}` : String(text || '');
  const flags = SIGNALS.filter((signal) => signal.re.test(value)).map(({ id, label, why, hard = false, weight }) => ({ id, label, why, hard, weight }));
  if (upi && !upi.merchant) flags.push({ id: 'no_merchant', label: 'This QR is not a registered merchant', why: 'A shop or company QR carries a merchant code. This one does not, so the money goes to a person.', hard: false, weight: 15 });
  // Something the customer does inside their own app gets a caution from a model's
  // doubt, not a "do not pay": it flagged an ordinary EMI reminder in testing.
  const ownApp = /\b(own app|in the app|saved biller|from the app|your app)\b/i.test(value);
  if (modelRisk === 'likely_scam' && !flags.some((flag) => flag.hard)) {
    flags.unshift({ id: 'pattern', label: 'Looks like a common scam pattern', why: 'A stranger, a reason to hurry, and a request for money or details: that is how these usually work.', hard: !ownApp, weight: ownApp ? 20 : 60 });
  }
  const score = Math.max(100 - flags.reduce((total, flag) => total + flag.weight, 0), 0);
  const hard = flags.some((flag) => flag.hard);
  const { stopBelowScore, cautionBelowScore } = pack.assumptions;
  // Rules can miss a new scam, so silence is not safety: contact the customer did not
  // start never gets an all-clear, however clean the words look.
  const unprompted = UNPROMPTED.test(value);
  const verdict = hard || score < stopBelowScore ? 'stop' : score < cautionBelowScore || unprompted ? 'caution' : 'clear';
  const action = {
    stop: `Do not pay and do not enter your PIN. If you have already paid, call ${pack.rules.helpline} right away and report at ${pack.rules.portal}.`,
    caution: `I cannot confirm this is safe. Check inside your own app or on ${pack.rules.sachet} before you pay or share anything.`,
    clear: 'I found no red flags in this text. That does not prove it is safe, so pay only someone you recognise.',
  }[verdict];
  return {
    verdict, score, flags, action, helpline: pack.rules.helpline, portal: pack.rules.portal, upi,
    checkedText: value.slice(0, 400),
    formula: `Safety score = 100 − sum of weights for ${flags.length} red flags${hard ? '; any hard stop means do not pay' : ''}`,
    pack: packStamp(pack),
  };
}
