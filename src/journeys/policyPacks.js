// Dated policy packs. Every figure MITRA computes records which pack it used,
// so a rule change is a new pack version, not a silent change to old answers.
//
// `rules` come from the published source. `assumptions` are MITRA's own defaults
// and are labelled that way on screen: a partner would replace them.

export const PACKS = Object.freeze({
  lending: Object.freeze({
    id: 'rbi-digital-lending-2025',
    label: 'RBI digital lending rules, May 2025 edition',
    asOf: '2025-05-08',
    rules: Object.freeze({
      coolingOffMinDays: 1,
      coolingOffExit: 'principal and the proportionate APR, with no penalty',
      kfsRequired: true,
    }),
    assumptions: Object.freeze({ emiFitComfortablePct: 30, emiFitStretchPct: 40, largeLoanForHumanReview: 500000 }),
    sources: Object.freeze([
      'Reserve Bank of India (Digital Lending) Directions, 2025 (8 May 2025)',
      'RBI circular on Key Facts Statement for Loans & Advances (15 Apr 2024)',
    ]),
  }),
  prepayment: Object.freeze({
    id: 'rbi-prepayment-2025',
    label: 'RBI pre-payment charges rules, effective Jan 2026',
    asOf: '2026-01-01',
    rules: Object.freeze({
      noChargeWhen: 'floating-rate loans to individuals for non-business purposes, sanctioned on or after 1 Jan 2026',
      otherwise: "the lender's approved policy, as stated in the loan terms",
    }),
    assumptions: Object.freeze({}),
    sources: Object.freeze(['Reserve Bank of India (Pre-payment Charges on Loans) Directions, 2025']),
  }),
  insurance: Object.freeze({
    id: 'irdai-policyholder-2024',
    label: 'IRDAI policyholder rules, 2024 master circular',
    asOf: '2024-05-29',
    rules: Object.freeze({ freeLookDays: 30, preExistingWaitMaxMonths: 36, moratoriumMonths: 60 }),
    assumptions: Object.freeze({
      lifeCoverMultipleByDependants: Object.freeze([6, 10, 12, 15]),
      healthCoverMetro: 1500000,
      healthCoverOther: 1000000,
      metroCities: Object.freeze(['mumbai', 'delhi', 'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune']),
    }),
    sources: Object.freeze(['IRDAI Master Circular on Health Insurance Business (29 May 2024)']),
  }),
  claims: Object.freeze({
    id: 'irdai-claims-2024',
    label: 'IRDAI health claim rules, 2024 master circular',
    asOf: '2024-05-29',
    rules: Object.freeze({
      cashlessAuthHours: 1,
      dischargeAuthHours: 3,
      decisionDaysAfterLastDocument: 30,
      notProportionate: Object.freeze(['pharmacy', 'consumables', 'implants', 'medical devices', 'diagnostics']),
    }),
    assumptions: Object.freeze({}),
    sources: Object.freeze(['IRDAI Master Circular on Health Insurance Business (29 May 2024)']),
  }),
  grievance: Object.freeze({
    id: 'grievance-routes-2026',
    label: 'Grievance routes, 2026',
    asOf: '2026-07-01',
    rules: Object.freeze({
      firstComplaintDays: 30,
      rbi: 'RBI Integrated Ombudsman Scheme, 2026 at cms.rbi.org.in, free of charge',
      insurance: 'Insurance Ombudsman at cioins.co.in, within one year of the insurer’s reply',
    }),
    assumptions: Object.freeze({}),
    sources: Object.freeze(['Reserve Bank Integrated Ombudsman Scheme, 2026 (effective 1 Jul 2026)', 'Insurance Ombudsman Rules, 2017']),
  }),
  payments: Object.freeze({
    id: 'upi-safety-2026',
    label: 'UPI and digital payment safety checks, 2026',
    asOf: '2026-10-01',
    rules: Object.freeze({ helpline: '1930', portal: 'cybercrime.gov.in', sachet: 'sachet.rbi.org.in' }),
    assumptions: Object.freeze({ stopBelowScore: 50, cautionBelowScore: 80 }),
    sources: Object.freeze(['RBI consumer advisories', 'National Cyber Crime Reporting Portal']),
  }),
  merchant: Object.freeze({
    id: 'merchant-credit-2026',
    label: 'Merchant working capital checks, 2026',
    asOf: '2026-10-01',
    rules: Object.freeze({}),
    assumptions: Object.freeze({ minActiveMonths: 6, maxOfAverageMonthlySales: 0.5, maxDailyRepaymentOfDailySalesPct: 15 }),
    sources: Object.freeze(['RBI digital lending rules, May 2025 edition']),
  }),
  // Reading income that does not come as a salary slip. Every number here is MITRA's
  // own default, labelled on screen; a partner lender would replace them.
  income: Object.freeze({
    id: 'mitra-income-2026',
    label: 'Income from bank statements, receipts and tax returns, 2026',
    asOf: '2026-10-01',
    rules: Object.freeze({}),
    assumptions: Object.freeze({
      minMonths: 3,
      weakMonths: 3,
      roundTo: 100,
      emiComfortablePct: 30,
      emiStretchPct: 40,
      declaredGapPct: 25,
      steadyBelowPct: 15,
      unevenBelowPct: 30,
    }),
    // Matched against the narration on a statement line. Order matters: a refund
    // from a platform is not a payout from it.
    credits: Object.freeze({
      excluded: Object.freeze(['self transfer', 'own account', 'refund', 'reversal', 'reversed', 'loan disburs\\w*', 'cashback', 'int\\.? cr', 'interest']),
      salary: Object.freeze(['salary', 'sal cr', 'payroll']),
      platform: Object.freeze(['payouts?', 'earnings', 'driver', 'rider', 'delivery partner', 'incentive']),
      cash: Object.freeze(['cash deposit', 'cash dep', 'cdm', 'by cash']),
      upi: Object.freeze(['upi', 'settlement', 'soundbox', 'pos', 'card sale', 'qr']),
    }),
    debits: Object.freeze({
      emi: Object.freeze(['emi', 'loan', 'ach', 'nach', 'ecs']),
      business: Object.freeze(['wholesale', 'distributors?', 'traders', 'supplier', 'purchase', 'stock', 'agencies']),
      rent: Object.freeze(['rent']),
    }),
    sources: Object.freeze(['RBI digital lending rules, May 2025 edition', 'MITRA defaults for alternative income']),
  }),
  privacy: Object.freeze({
    id: 'dpdp-2025',
    label: 'DPDP Act 2023 and Rules 2025',
    asOf: '2025-11-14',
    rules: Object.freeze({ consentIs: 'specific to one purpose and withdrawable as easily as it was given' }),
    assumptions: Object.freeze({ consentDays: 30 }),
    sources: Object.freeze(['Digital Personal Data Protection Act, 2023', 'DPDP Rules, 2025']),
  }),
});

export const packStamp = (pack) => ({ id: pack.id, label: pack.label, asOf: pack.asOf });
