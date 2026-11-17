/**
 * Borrower-facing wording in English and Kinyarwanda, shared by the web
 * portal, the mobile app and the API (SMS and in-app notices).
 *
 * Staff screens stay in English. French is in the database enum but has no
 * borrower wording yet, so it falls back to English.
 *
 * The Kinyarwanda text is a careful first draft. Before go-live, have a native
 * speaker on the lender's team read every line (see RW_REVIEW_STATUS) — loan
 * terms must be understood exactly.
 */
import { formatRwf } from './money';

export const BORROWER_LANGUAGES = ['EN', 'RW'] as const;
export type BorrowerLanguage = (typeof BORROWER_LANGUAGES)[number];

/** Updated by the lender once a native speaker has signed the wording off. */
export const RW_REVIEW_STATUS = 'draft' as 'draft' | 'reviewed';

export const LANGUAGE_NAMES: Record<BorrowerLanguage, string> = {
  EN: 'English',
  RW: 'Ikinyarwanda',
};

/** Anything the database may hold (EN, RW, FR, null) narrowed to a language we can show. */
export function borrowerLanguage(value: string | null | undefined): BorrowerLanguage {
  return value === 'RW' ? 'RW' : 'EN';
}

const EN = {
  // ── shared ──
  'common.loading': 'Loading…',
  'common.opening': 'Opening…',
  'common.checkingSession': 'Checking your session…',
  'common.tryAgain': 'Try again',
  'common.back': 'Back',
  'common.backHome': 'Back to home',
  'common.continue': 'Continue',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.edit': 'Edit',
  'common.oneMoment': 'One moment…',
  'common.skipToContent': 'Skip to content',
  'common.language': 'Language',
  'common.languageHint': 'The app, and the SMS we send you, will use this language.',
  'common.languageSaved': 'Language saved.',
  'common.months': '{n} months',
  'common.monthsShort': '{n} mo',
  'common.perYear': '{rate} a year',
  'common.left': '{amount} left',
  'common.upTo': 'Up to {amount}',
  'common.notGiven': 'Not given',

  // ── navigation ──
  'nav.home': 'Home',
  'nav.apply': 'Apply',
  'nav.alerts': 'Alerts',
  'nav.profile': 'Profile',
  'nav.label': 'Borrower',
  'portal.subtitle': 'Borrower portal',
  'portal.website': 'Website',

  // ── sign-in ──
  'signin.taglineWeb': 'Check your loan, pay with MoMo, or apply — sign in with your phone.',
  'signin.taglineApp': 'Loans for your business, paid with MoMo.',
  'signin.titlePhone': 'Sign in with your phone',
  'signin.titleCode': 'Enter your code',
  'signin.codeSent': 'We sent a 6-digit code by SMS to {phone}.',
  'signin.enterPhone':
    'Enter the phone number on your {lender} account. You may get a texted code if your lender requires one.',
  'signin.codeLabel': '6-digit code',
  'signin.phoneLabel': 'Phone number',
  'signin.submit': 'Sign in',
  'signin.differentNumber': 'Use a different number',
  'signin.onlyCustomers':
    'Only customers of {lender} can sign in. Not a customer yet? Visit a branch.',
  'signin.unknownAddress': 'This address is not in use',
  'signin.unknownAddressBody':
    'Check the link your lender gave you. Each lender on {product} has its own address.',

  // ── home ──
  'home.greeting': 'Muraho,',
  'home.notifications': 'Notifications',
  'home.notificationsUnread': 'Notifications, {n} unread',
  'home.instalmentOf': 'Instalment {n} of {total}',
  'home.dueOn': 'due {date}',
  'home.wasDueOn': 'was due {date}',
  'home.nextPayment': 'Next payment',
  'home.paymentOverdue': 'Payment overdue',
  'home.allPaid': 'All paid',
  'home.nothingDue': 'Nothing due',
  'home.onTrack': 'On track',
  'home.repaid': '{pct}% repaid',
  'home.payWithMomo': 'Pay with MoMo',
  'home.payAmountWithMomo': 'Pay {amount} with MoMo',
  'home.waitingMomo': 'Waiting for MoMo…',
  'home.waitingMomoApproval': 'Waiting for MoMo approval…',
  'home.paymentPending': 'Payment pending',
  'home.fullyPaid': 'Fully paid',
  'home.schedule': 'Schedule',
  'home.viewSchedule': 'View schedule',
  'home.checkPhone': 'Check your phone for the MoMo prompt and enter your PIN to approve.',
  'home.paymentReceived': 'Payment received. Thank you!',
  'home.paymentFailed': 'The payment did not go through.',
  'home.noWallet': 'No MoMo wallet linked. Pay at a branch, or ask your officer to link one.',
  'home.nothingDueNow': 'Nothing due right now',
  'home.loanRepaid': 'Loan {code} · {pct}% repaid',
  'home.loanPrepared': 'Loan being prepared',
  'home.loanPreparedBody': '{code} will appear here once it is disbursed.',
  'home.loanOnWay': 'Your loan is on its way',
  'home.loanOnWayBody':
    '{code} is being sent to your MoMo wallet. We will text you when it arrives.',
  'home.inReview': 'Application in review',
  'home.inReviewBody': '{code} · {amount} · {product}. We will text you with the decision.',
  'home.noLoan': 'No active loan',
  'home.noLoanBodyWeb': 'Apply for a loan when you are ready. We will text you when it is decided.',
  'home.noLoanBodyApp': 'Apply in 5 minutes, right here.',
  'home.applyForLoan': 'Apply for a loan',
  'home.newLoan': 'New loan',
  'home.quickActions': 'Quick actions',
  'home.preApprovedOffer': 'Pre-approved offer',
  'home.preApprovedForYou': 'Pre-approved for you',
  'home.useOffer': 'Use this offer',
  'home.topUp': 'Top up your {product} in 5 minutes',
  'home.recentActivity': 'Recent activity',
  'home.seeAll': 'See all',
  'home.noPayments': 'No payments yet.',
  'home.confirmPayment': 'Confirm payment',
  'home.amount': 'Amount',
  'home.from': 'From',
  'home.for': 'For',
  'home.fee': 'Fee',
  'home.momoPromptNote': 'You’ll get a MoMo prompt on your phone. Enter your PIN there to approve.',
  'home.pay': 'Pay',
  'home.payAmount': 'Pay {amount}',

  // ── schedule ──
  'schedule.title': 'Repayment schedule',
  'schedule.rateLine': '{code} · {amount} at {rate} a year',
  'schedule.chooseLoan': 'Choose a loan from Home.',
  'state.PAID': 'Paid',
  'state.PARTIAL': 'Part paid',
  'state.OVERDUE': 'Overdue',
  'state.DUE_NEXT': 'Due next',
  'state.UPCOMING': 'Upcoming',

  // ── notifications ──
  'alerts.title': 'Alerts',
  'alerts.empty': 'No alerts yet.',
  'alerts.kind.PAYMENT': 'payment',
  'alerts.kind.SYSTEM': 'update',
  'alerts.kind.CONTRACT': 'contract',
  'alerts.kind.RISK': 'account',
  'alerts.kind.AI_FLAG': 'review',

  // ── profile ──
  'profile.title': 'Profile',
  'profile.loans': 'Your loans',
  'profile.noLoans': 'No loans yet.',
  'profile.customerNumber': 'Customer number',
  'profile.phone': 'Phone',
  'profile.nationalId': 'National ID',
  'profile.identity': 'Identity',
  'profile.business': 'Business',
  'profile.verified': 'Verified',
  'profile.pending': 'Pending',
  'profile.kyc.VERIFIED': 'Verified',
  'profile.kyc.PENDING': 'Pending',
  'profile.kyc.REJECTED': 'Not verified',
  'profile.kyc.EXPIRED': 'Expired',
  'loanStatus.ACTIVE': 'Active',
  'loanStatus.REPAID': 'Repaid',
  'loanStatus.PENDING_DISBURSEMENT': 'Sending',
  'loanStatus.WRITTEN_OFF': 'Closed',
  'loanStatus.CLOSED': 'Closed',
  'profile.yourData': 'Your data',
  'profile.dataNote':
    '{lender} keeps your data in Rwanda and uses it only to manage your loans. You can withdraw permissions here at any time.',
  'profile.momoSharing': 'MoMo history sharing',
  'profile.momoShared': 'You shared wallet history to help with credit decisions.',
  'profile.stopMomo': 'Stop sharing MoMo history',
  'profile.momoNotShared': 'MoMo history: not shared.',
  'profile.signOut': 'Sign out',
  'profile.signingOut': 'Signing out…',

  // ── apply ──
  'apply.title': 'Apply for a loan',
  'apply.loadingProducts': 'Loading products…',
  'apply.noProducts': 'No products are open for applications right now. Check back later.',
  'apply.stepOf': 'Step {n} of 3 · {title}',
  'apply.stepLoan': 'Loan details',
  'apply.stepDetails': 'Your details',
  'apply.stepReview': 'Review & submit',
  'apply.sent': 'Application sent',
  'apply.sentBody':
    'We’re reviewing your request for {amount}. We’ll send you an SMS as soon as there’s a decision.',
  'apply.reference': 'Reference',
  'apply.status': 'Status',
  'apply.expectedDecision': 'Expected decision',
  'apply.product': 'Product',
  'apply.howMuch': 'How much do you need?',
  'apply.loanAmount': 'Loan amount',
  'apply.amountRwf': 'Amount (RWF)',
  'apply.preApprovedUpTo': 'Pre-approved up to {amount}',
  'apply.repayOver': 'Repay over',
  'apply.termMonths': 'Term (months)',
  'apply.purpose': 'What is the loan for?',
  'apply.purposeShort': 'Purpose',
  'apply.monthlyInstalment': 'Monthly instalment',
  'apply.totalInterest': 'Total interest',
  'apply.totalToRepay': 'Total to repay',
  'apply.firstPayment': 'First payment',
  'apply.rate': 'Rate',
  'apply.affordability':
    'This would be {ratio} of your income; we lend up to {limit}. You can still apply and a loan officer will review it, or try a smaller amount or a longer term.',
  'apply.noFees': 'No fees to apply · Decision within 1 working day',
  'apply.aboutBusiness': 'Tell us about your business',
  'apply.businessName': 'Business name',
  'apply.businessNamePlaceholder': 'e.g. Uwase Tailoring',
  'apply.sector': 'Sector',
  'apply.monthlyRevenue': 'Average monthly revenue (RWF)',
  'apply.monthlyRevenueShort': 'Monthly revenue',
  'apply.identity': 'Identity',
  'apply.verifiedNida': '✓ Verified with NIDA',
  'apply.nationalIdNumber': 'National ID number (16 digits)',
  'apply.digits16': '16 digits',
  'apply.idOnFile': 'ID on file: {id}',
  'apply.uploading': 'Uploading…',
  'apply.addId': 'Add ID photo',
  'apply.idAdded': 'ID front · added',
  'apply.takeSelfie': 'Take a selfie',
  'apply.selfieAdded': 'Selfie · added',
  'apply.photosHint': 'An ID photo and a selfie let us verify you faster.',
  'apply.statements': 'Statements',
  'apply.shareMomo': 'Share 6 months of MoMo history',
  'apply.shareMomoHint': 'Faster decision, no upload needed',
  'apply.reviewApplication': 'Review application',
  'apply.encrypted': '🔒 Your data is encrypted and only used for this application',
  'apply.checkEverything': 'Check everything looks right',
  'apply.borrowing': 'You’re borrowing',
  'apply.monthly': 'Monthly',
  'apply.term': 'Term',
  'apply.yourDetails': 'Your details',
  'apply.momoHistory': 'MoMo history',
  'apply.sharedSix': 'Shared (6 months)',
  'apply.notShared': 'Not shared',
  'apply.moneyGoesTo': 'Money goes to',
  'apply.wallet': 'Wallet',
  'apply.noWallet': 'No MoMo wallet linked · ask your officer',
  'apply.agreeTerms':
    'I agree to the loan terms and to {lender} processing my data for this application.',
  'apply.agreeBureau': '{lender} may check my credit record with the credit bureau.',
  'apply.submit': 'Submit application',
  'apply.sending': 'Sending…',
  'apply.decisionWithin': 'You’ll get a decision within 1 working day',
  'apply.inReview': 'In review',
  'apply.withinOneDay': 'Within 1 working day',

  // ── choices (values stay in English; only the label changes) ──
  'option.Stock': 'Stock',
  'option.Equipment': 'Equipment',
  'option.Expand shop': 'Expand shop',
  'option.School fees': 'School fees',
  'option.Working capital': 'Working capital',
  'option.Other': 'Other',
  'option.Garments & tailoring': 'Garments & tailoring',
  'option.Retail shop': 'Retail shop',
  'option.Agriculture': 'Agriculture',
  'option.Transport': 'Transport',

  // ── activity and in-app notices (written by the API) ──
  'activity.instalmentPaid': 'Instalment {n} paid',
  'activity.instalmentPaidEarly': 'Instalment {n} paid early',
  'activity.paymentReceived': 'Payment received',
  'notice.paymentReceived': 'We received {amount} for {code}',
  'notice.preApproved': 'You are pre-approved for up to {amount}',

  // ── errors ──
  'error.generic': 'Something went wrong. Try again.',
  'error.server': 'Something went wrong on our side. Try again in a moment.',
  'error.offline': 'Could not reach the server. Check your connection and try again.',
} as const;

export type MessageKey = keyof typeof EN;

const RW: Record<MessageKey, string> = {
  'common.loading': 'Tegereza gato…',
  'common.opening': 'Turafungura…',
  'common.checkingSession': 'Turimo kugenzura konti yawe…',
  'common.tryAgain': 'Ongera ugerageze',
  'common.back': 'Subira inyuma',
  'common.backHome': 'Subira ahabanza',
  'common.continue': 'Komeza',
  'common.cancel': 'Hagarika',
  'common.close': 'Funga',
  'common.edit': 'Hindura',
  'common.oneMoment': 'Akanya gato…',
  'common.skipToContent': 'Jya ku bikubiyemo',
  'common.language': 'Ururimi',
  'common.languageHint': 'Porogaramu n’ubutumwa bugufi (SMS) tukoherereza bizakoresha uru rurimi.',
  'common.languageSaved': 'Ururimi rwabitswe.',
  'common.months': 'Amezi {n}',
  'common.monthsShort': 'Amezi {n}',
  'common.perYear': '{rate} ku mwaka',
  'common.left': 'Hasigaye {amount}',
  'common.upTo': 'Kugeza kuri {amount}',
  'common.notGiven': 'Ntiyatanzwe',

  'nav.home': 'Ahabanza',
  'nav.apply': 'Saba',
  'nav.alerts': 'Ubutumwa',
  'nav.profile': 'Konti',
  'nav.label': 'Umukiriya',
  'portal.subtitle': 'Urubuga rw’abakiriya',
  'portal.website': 'Urubuga rwacu',

  'signin.taglineWeb':
    'Reba inguzanyo yawe, wishyure na MoMo, cyangwa usabe inguzanyo — injira ukoresheje telefone yawe.',
  'signin.taglineApp': 'Inguzanyo z’ubucuruzi bwawe, zishyurwa na MoMo.',
  'signin.titlePhone': 'Injira ukoresheje telefone yawe',
  'signin.titleCode': 'Andika kode yawe',
  'signin.codeSent': 'Twakoherereje kode y’imibare 6 kuri SMS kuri {phone}.',
  'signin.enterPhone':
    'Andika nimero ya telefone iri kuri konti yawe ya {lender}. Ushobora kwakira kode kuri SMS niba ikigo cyawe kibisaba.',
  'signin.codeLabel': 'Kode y’imibare 6',
  'signin.phoneLabel': 'Nimero ya telefone',
  'signin.submit': 'Injira',
  'signin.differentNumber': 'Koresha indi nimero',
  'signin.onlyCustomers':
    'Abakiriya ba {lender} ni bo bonyine bashobora kwinjira. Nturaba umukiriya? Gana ishami ryacu.',
  'signin.unknownAddress': 'Iyi aderesi ntikoreshwa',
  'signin.unknownAddressBody':
    'Reba neza aderesi wahawe n’ikigo cyakugurije. Buri kigo kiri kuri {product} gifite aderesi yacyo.',

  'home.greeting': 'Muraho,',
  'home.notifications': 'Ubutumwa',
  'home.notificationsUnread': 'Ubutumwa, {n} butarasomwa',
  'home.instalmentOf': 'Igice cya {n} muri {total}',
  'home.dueOn': 'kizishyurwa ku ya {date}',
  'home.wasDueOn': 'cyagombaga kwishyurwa ku ya {date}',
  'home.nextPayment': 'Ubwishyu bukurikira',
  'home.paymentOverdue': 'Ubwishyu bwarengeje igihe',
  'home.allPaid': 'Byose byishyuwe',
  'home.nothingDue': 'Nta kigomba kwishyurwa',
  'home.onTrack': 'Biragenda neza',
  'home.repaid': 'Hishyuwe {pct}%',
  'home.payWithMomo': 'Ishyura na MoMo',
  'home.payAmountWithMomo': 'Ishyura {amount} na MoMo',
  'home.waitingMomo': 'Dutegereje MoMo…',
  'home.waitingMomoApproval': 'Dutegereje ko wemeza kuri MoMo…',
  'home.paymentPending': 'Ubwishyu buracyategerejwe',
  'home.fullyPaid': 'Yishyuwe yose',
  'home.schedule': 'Ingengabihe',
  'home.viewSchedule': 'Reba ingengabihe',
  'home.checkPhone':
    'Reba kuri telefone yawe ubutumwa bwa MoMo, maze wandike PIN yawe kugira ngo wemeze.',
  'home.paymentReceived': 'Twakiriye ubwishyu. Murakoze!',
  'home.paymentFailed': 'Ubwishyu ntibwakunze.',
  'home.noWallet':
    'Nta konti ya MoMo ihujwe. Ishyurira ku ishami, cyangwa usabe umukozi ugukurikirana kuyihuza.',
  'home.nothingDueNow': 'Nta kigomba kwishyurwa ubu',
  'home.loanRepaid': 'Inguzanyo {code} · hishyuwe {pct}%',
  'home.loanPrepared': 'Inguzanyo iri gutegurwa',
  'home.loanPreparedBody': '{code} izagaragara hano nimara koherezwa.',
  'home.loanOnWay': 'Inguzanyo yawe iri mu nzira',
  'home.loanOnWayBody':
    '{code} iri koherezwa kuri konti yawe ya MoMo. Tuzakoherereza SMS nigera kuri konti.',
  'home.inReview': 'Ubusabe buri gusuzumwa',
  'home.inReviewBody': '{code} · {amount} · {product}. Tuzakoherereza SMS y’icyemezo.',
  'home.noLoan': 'Nta nguzanyo ufite ubu',
  'home.noLoanBodyWeb':
    'Saba inguzanyo igihe witeguye. Tuzakoherereza SMS icyemezo nikimara gufatwa.',
  'home.noLoanBodyApp': 'Saba inguzanyo mu minota 5, hano nyine.',
  'home.applyForLoan': 'Saba inguzanyo',
  'home.newLoan': 'Inguzanyo nshya',
  'home.quickActions': 'Ibikorwa byihuse',
  'home.preApprovedOffer': 'Inguzanyo wemerewe mbere',
  'home.preApprovedForYou': 'Wemerewe mbere',
  'home.useOffer': 'Koresha iki gitekerezo',
  'home.topUp': 'Ongera kuri {product} yawe mu minota 5',
  'home.recentActivity': 'Ibikorwa biheruka',
  'home.seeAll': 'Reba byose',
  'home.noPayments': 'Nta bwishyu buraba.',
  'home.confirmPayment': 'Emeza ubwishyu',
  'home.amount': 'Amafaranga',
  'home.from': 'Bivuye kuri',
  'home.for': 'Bigenewe',
  'home.fee': 'Ikiguzi',
  'home.momoPromptNote':
    'Uzakira ubutumwa bwa MoMo kuri telefone yawe. Andikamo PIN yawe kugira ngo wemeze.',
  'home.pay': 'Ishyura',
  'home.payAmount': 'Ishyura {amount}',

  'schedule.title': 'Ingengabihe yo kwishyura',
  'schedule.rateLine': '{code} · {amount} ku nyungu ya {rate} ku mwaka',
  'schedule.chooseLoan': 'Hitamo inguzanyo ahabanza.',
  'state.PAID': 'Cyishyuwe',
  'state.PARTIAL': 'Cyishyuwe igice',
  'state.OVERDUE': 'Cyarengeje igihe',
  'state.DUE_NEXT': 'Igikurikira',
  'state.UPCOMING': 'Kizaza',

  'alerts.title': 'Ubutumwa',
  'alerts.empty': 'Nta butumwa buraza.',
  'alerts.kind.PAYMENT': 'ubwishyu',
  'alerts.kind.SYSTEM': 'amakuru',
  'alerts.kind.CONTRACT': 'amasezerano',
  'alerts.kind.RISK': 'konti',
  'alerts.kind.AI_FLAG': 'isuzuma',

  'profile.title': 'Konti yanjye',
  'profile.loans': 'Inguzanyo zawe',
  'profile.noLoans': 'Nta nguzanyo uragira.',
  'profile.customerNumber': 'Nimero y’umukiriya',
  'profile.phone': 'Telefone',
  'profile.nationalId': 'Indangamuntu',
  'profile.identity': 'Kwemeza umwirondoro',
  'profile.business': 'Ubucuruzi',
  'profile.verified': 'Byemejwe',
  'profile.pending': 'Biracyategerejwe',
  'profile.kyc.VERIFIED': 'Byemejwe',
  'profile.kyc.PENDING': 'Biracyategerejwe',
  'profile.kyc.REJECTED': 'Ntibyemejwe',
  'profile.kyc.EXPIRED': 'Byarangiye',
  'loanStatus.ACTIVE': 'Irakora',
  'loanStatus.REPAID': 'Yishyuwe',
  'loanStatus.PENDING_DISBURSEMENT': 'Iri koherezwa',
  'loanStatus.WRITTEN_OFF': 'Yafunzwe',
  'loanStatus.CLOSED': 'Yafunzwe',
  'profile.yourData': 'Amakuru yawe',
  'profile.dataNote':
    '{lender} ibika amakuru yawe mu Rwanda kandi iyakoresha gusa mu gucunga inguzanyo zawe. Ushobora kwisubiraho ku ruhushya watanze igihe icyo ari cyo cyose.',
  'profile.momoSharing': 'Gusangiza amateka ya MoMo',
  'profile.momoShared':
    'Wasangije amateka ya konti yawe ya MoMo kugira ngo bifashe gufata icyemezo ku nguzanyo.',
  'profile.stopMomo': 'Hagarika gusangiza amateka ya MoMo',
  'profile.momoNotShared': 'Amateka ya MoMo: ntiyasangijwe.',
  'profile.signOut': 'Sohoka',
  'profile.signingOut': 'Turimo gusohoka…',

  'apply.title': 'Saba inguzanyo',
  'apply.loadingProducts': 'Turimo gushaka ubwoko bw’inguzanyo…',
  'apply.noProducts': 'Nta nguzanyo zirimo gusabwa ubu. Uzagaruke nyuma.',
  'apply.stepOf': 'Intambwe ya {n} muri 3 · {title}',
  'apply.stepLoan': 'Ibijyanye n’inguzanyo',
  'apply.stepDetails': 'Amakuru yawe',
  'apply.stepReview': 'Suzuma wohereze',
  'apply.sent': 'Ubusabe bwoherejwe',
  'apply.sentBody':
    'Turimo gusuzuma ubusabe bwawe bwa {amount}. Tuzakoherereza SMS icyemezo nikimara gufatwa.',
  'apply.reference': 'Nimero y’ubusabe',
  'apply.status': 'Uko bihagaze',
  'apply.expectedDecision': 'Icyemezo giteganyijwe',
  'apply.product': 'Ubwoko bw’inguzanyo',
  'apply.howMuch': 'Ukeneye angahe?',
  'apply.loanAmount': 'Amafaranga y’inguzanyo',
  'apply.amountRwf': 'Amafaranga (RWF)',
  'apply.preApprovedUpTo': 'Wemerewe kugeza kuri {amount}',
  'apply.repayOver': 'Kwishyura mu gihe cya',
  'apply.termMonths': 'Igihe (amezi)',
  'apply.purpose': 'Inguzanyo igenewe iki?',
  'apply.purposeShort': 'Icyo igenewe',
  'apply.monthlyInstalment': 'Igice cya buri kwezi',
  'apply.totalInterest': 'Inyungu yose',
  'apply.totalToRepay': 'Igiteranyo cyo kwishyura',
  'apply.firstPayment': 'Ubwishyu bwa mbere',
  'apply.rate': 'Inyungu',
  'apply.affordability':
    'Ibi byaba {ratio} by’amafaranga winjiza; dutanga inguzanyo kugeza kuri {limit}. Ushobora gusaba umukozi ushinzwe inguzanyo akabisuzuma, cyangwa ugerageze amafaranga make cyangwa igihe kirekire.',
  'apply.noFees': 'Nta kiguzi cyo gusaba · Icyemezo mu munsi 1 w’akazi',
  'apply.aboutBusiness': 'Tubwire ku bucuruzi bwawe',
  'apply.businessName': 'Izina ry’ubucuruzi',
  'apply.businessNamePlaceholder': 'urugero: Uwase Tailoring',
  'apply.sector': 'Urwego',
  'apply.monthlyRevenue': 'Amafaranga yinjira buri kwezi (RWF)',
  'apply.monthlyRevenueShort': 'Ayinjira buri kwezi',
  'apply.identity': 'Umwirondoro',
  'apply.verifiedNida': '✓ Byemejwe na NIDA',
  'apply.nationalIdNumber': 'Nimero y’indangamuntu (imibare 16)',
  'apply.digits16': 'Imibare 16',
  'apply.idOnFile': 'Indangamuntu yanditswe: {id}',
  'apply.uploading': 'Birimo koherezwa…',
  'apply.addId': 'Ongeramo ifoto y’indangamuntu',
  'apply.idAdded': 'Indangamuntu · yongewemo',
  'apply.takeSelfie': 'Ifotore',
  'apply.selfieAdded': 'Ifoto yawe · yongewemo',
  'apply.photosHint': 'Ifoto y’indangamuntu n’ifoto yawe bidufasha kukwemeza vuba.',
  'apply.statements': 'Amateka ya konti',
  'apply.shareMomo': 'Sangiza amateka ya MoMo y’amezi 6',
  'apply.shareMomoHint': 'Icyemezo cyihuse, nta nyandiko wohereza',
  'apply.reviewApplication': 'Suzuma ubusabe',
  'apply.encrypted': '🔒 Amakuru yawe arinzwe kandi akoreshwa kuri ubu busabe gusa',
  'apply.checkEverything': 'Reba ko byose ari byo',
  'apply.borrowing': 'Urasaba',
  'apply.monthly': 'Buri kwezi',
  'apply.term': 'Igihe',
  'apply.yourDetails': 'Amakuru yawe',
  'apply.momoHistory': 'Amateka ya MoMo',
  'apply.sharedSix': 'Yasangijwe (amezi 6)',
  'apply.notShared': 'Ntiyasangijwe',
  'apply.moneyGoesTo': 'Amafaranga azoherezwa kuri',
  'apply.wallet': 'Konti ya MoMo',
  'apply.noWallet': 'Nta konti ya MoMo ihujwe · baza umukozi ugukurikirana',
  'apply.agreeTerms':
    'Nemeye amabwiriza y’inguzanyo kandi nemera ko {lender} ikoresha amakuru yanjye kuri ubu busabe.',
  'apply.agreeBureau':
    '{lender} ishobora kureba amateka yanjye y’inguzanyo mu kigo gishinzwe amakuru ku nguzanyo (credit bureau).',
  'apply.submit': 'Ohereza ubusabe',
  'apply.sending': 'Birimo koherezwa…',
  'apply.decisionWithin': 'Uzabona icyemezo mu munsi 1 w’akazi',
  'apply.inReview': 'Buri gusuzumwa',
  'apply.withinOneDay': 'Mu munsi 1 w’akazi',

  'option.Stock': 'Ibicuruzwa',
  'option.Equipment': 'Ibikoresho',
  'option.Expand shop': 'Kwagura iduka',
  'option.School fees': 'Amafaranga y’ishuri',
  'option.Working capital': 'Igishoro cyo gukora',
  'option.Other': 'Ibindi',
  'option.Garments & tailoring': 'Imyenda n’ubudozi',
  'option.Retail shop': 'Iduka ricuruza',
  'option.Agriculture': 'Ubuhinzi',
  'option.Transport': 'Ubwikorezi',

  'activity.instalmentPaid': 'Igice cya {n} cyishyuwe',
  'activity.instalmentPaidEarly': 'Igice cya {n} cyishyuwe mbere y’igihe',
  'activity.paymentReceived': 'Twakiriye ubwishyu',
  'notice.paymentReceived': 'Twakiriye {amount} ku nguzanyo {code}',
  'notice.preApproved': 'Wemerewe mbere inguzanyo igera kuri {amount}',

  'error.generic': 'Habaye ikibazo. Ongera ugerageze.',
  'error.server': 'Habaye ikibazo kuri twe. Ongera ugerageze mu kanya.',
  'error.offline': 'Ntitwabashije kugera kuri seriveri. Reba internet yawe maze wongere ugerageze.',
};

export const BORROWER_MESSAGES: Record<BorrowerLanguage, Record<MessageKey, string>> = { EN, RW };

export type MessageVars = Record<string, string | number>;

/** Fill `{name}` placeholders. A missing value is left visible rather than hidden. */
function fill(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : whole,
  );
}

export function translate(lang: BorrowerLanguage, key: MessageKey, vars?: MessageVars): string {
  return fill(BORROWER_MESSAGES[lang][key] ?? EN[key], vars);
}

/** A translator bound to one language, for components. */
export function translator(lang: BorrowerLanguage) {
  return (key: MessageKey, vars?: MessageVars) => translate(lang, key, vars);
}

/** Labels for choices whose stored value is English (loan purposes, sectors). */
export function optionLabel(lang: BorrowerLanguage, value: string): string {
  const key = `option.${value}` as MessageKey;
  return key in EN ? translate(lang, key) : value;
}

const MONTHS: Record<BorrowerLanguage, string[]> = {
  EN: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  RW: [
    'Mutarama',
    'Gashyantare',
    'Werurwe',
    'Mata',
    'Gicurasi',
    'Kamena',
    'Nyakanga',
    'Kanama',
    'Nzeri',
    'Ukwakira',
    'Ugushyingo',
    'Ukuboza',
  ],
};

/** "2026-05-04" → "4 May 2026" or "4 Gicurasi 2026". Accepts a full ISO timestamp too. */
export function formatDateIn(
  lang: BorrowerLanguage,
  date: string,
  opts: { year?: boolean } = {},
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new RangeError(`Not an ISO date: "${date}"`);
  const base = `${Number(m[3])} ${MONTHS[lang][Number(m[2]) - 1]}`;
  return opts.year === false ? base : `${base} ${m[1]}`;
}

/**
 * Borrower-facing API messages, translated on the device. The API answers in
 * English; known messages are shown in the borrower's language and anything
 * else falls through unchanged.
 */
const API_MESSAGES_RW: Record<string, string> = {
  'Choose a product': 'Hitamo ubwoko bw’inguzanyo',
  'Choose what the loan is for': 'Hitamo icyo inguzanyo igenewe',
  'Enter a Rwandan mobile number, e.g. 078 812 3412':
    'Andika nimero ya telefone yo mu Rwanda, urugero 078 812 3412',
  'No MoMo wallet is linked to this account': 'Nta konti ya MoMo ihujwe n’iyi konti',
  'No such loan': 'Iyo nguzanyo ntibonetse',
  'No such payment': 'Ubwo bwishyu ntibubonetse',
  'Nothing is due': 'Nta kigomba kwishyurwa',
  'Session expired': 'Igihe cyawe cyarangiye',
  'Session expired. Sign in again.': 'Igihe cyawe cyarangiye. Ongera winjire.',
  'Sign in to continue': 'Injira kugira ngo ukomeze',
  'That code is not valid': 'Iyo kode si yo',
  'That file is not a photo': 'Iyo dosiye si ifoto',
  'The photo must be under 8 MB': 'Ifoto igomba kuba munsi ya MB 8',
  'Upload a JPEG, PNG or WebP photo': 'Ohereza ifoto ya JPEG, PNG cyangwa WebP',
  'You need to agree to the loan terms to continue':
    'Ugomba kwemera amabwiriza y’inguzanyo kugira ngo ukomeze',
  'Too many codes requested. Try again in an hour.':
    'Wasabye kode nyinshi. Ongera ugerageze nyuma y’isaha imwe.',
  'That ID number is already registered to another customer. Please visit a branch.':
    'Iyo nimero y’indangamuntu yanditswe ku wundi mukiriya. Gana ishami ryacu.',
  'The payment did not go through.': 'Ubwishyu ntibwakunze.',
  [EN['error.generic']]: RW['error.generic'],
  [EN['error.server']]: RW['error.server'],
  [EN['error.offline']]: RW['error.offline'],
  'Could not reach Kora Lend. Check your connection and try again.': RW['error.offline'],
};

export function translateApiMessage(lang: BorrowerLanguage, message: string): string {
  if (lang === 'EN') return message;
  const exact = API_MESSAGES_RW[message];
  if (exact) return exact;
  const inReview = /^Your application (\S+) is still being reviewed$/.exec(message);
  if (inReview) return `Ubusabe bwawe ${inReview[1]} buracyasuzumwa`;
  return message;
}

// ── SMS ──

export type SmsTemplate =
  | 'reminder.due_soon'
  | 'reminder.overdue'
  | 'payment.received'
  | 'disbursement.sent'
  | 'application.received'
  | 'offer.preapproved'
  | 'checkin'
  | 'otp';

export interface SmsVars {
  lender: string;
  firstName?: string;
  amount?: bigint;
  loanCode?: string;
  applicationCode?: string;
  /** ISO date; formatted in the borrower's language. */
  date?: string;
  code?: string;
  /** The company's MoMo Pay merchant code, once it is real. */
  payCode?: string;
}

/** The wording of each SMS, signed with the lender's own name. */
export function smsText(lang: BorrowerLanguage, template: SmsTemplate, v: SmsVars): string {
  const amount = v.amount != null ? formatRwf(v.amount) : '';
  const date = v.date ? formatDateIn(lang, v.date, { year: false }) : '';
  if (lang === 'RW') {
    const hello = v.firstName ? `Muraho ${v.firstName}, ni ${v.lender}.` : `${v.lender}:`;
    const pay = v.payCode
      ? `Ishyura ukoresheje MoMo Pay ${v.payCode}`
      : 'Ishyura kuri MoMo cyangwa ku ishami';
    switch (template) {
      case 'reminder.due_soon':
        return `${hello} Igice cyawe cya ${amount} ku nguzanyo ${v.loanCode} kizishyurwa ku ya ${date}. ${pay}. Murakoze.`;
      case 'reminder.overdue':
        return `${hello} Turabibutsa ko ${amount} ku nguzanyo ${v.loanCode} byarengeje igihe. ${pay}, cyangwa udusubize twumvikane itariki. Murakoze.`;
      case 'payment.received':
        return `${v.lender}: twakiriye ${amount} ku nguzanyo ${v.loanCode}. Murakoze.`;
      case 'disbursement.sent':
        return `${v.lender}: ${amount} y’inguzanyo ${v.loanCode} yoherejwe kuri konti yawe ya MoMo. Igice cya mbere kizishyurwa ku ya ${date}.`;
      case 'application.received':
        return `${v.lender}: twakiriye ubusabe bwawe ${v.applicationCode} bwa ${amount}. Tuzakoherereza ubutumwa icyemezo nikimara gufatwa.`;
      case 'offer.preapproved':
        return `${hello} Wemerewe mbere kongererwa inguzanyo igera kuri ${amount}. Fungura porogaramu ya ${v.lender} usabe mu minota 5.`;
      case 'checkin':
        return `${hello} Igice gikurikira ku nguzanyo ${v.loanCode} kizishyurwa ku ya ${date}. Niba hari icyahindutse, udusubize tuzashakire hamwe igisubizo.`;
      case 'otp':
        return `${v.lender}: kode yawe yo kwinjira ni ${v.code}. Irarangira mu minota 5. Ntuyibwire undi muntu.`;
    }
  }
  const hello = v.firstName ? `Hello ${v.firstName}, this is ${v.lender}.` : `${v.lender}:`;
  const pay = v.payCode ? `Pay with MoMo Pay ${v.payCode}` : 'Pay with MoMo or at a branch';
  switch (template) {
    case 'reminder.due_soon':
      return `${hello} Your instalment of ${amount} on loan ${v.loanCode} is due on ${date}. ${pay}. Thank you.`;
    case 'reminder.overdue':
      return `${hello} A reminder that ${amount} on loan ${v.loanCode} is overdue. ${pay}, or reply to agree a date. Thank you.`;
    case 'payment.received':
      return `${v.lender}: we received ${amount} for loan ${v.loanCode}. Thank you.`;
    case 'disbursement.sent':
      return `${v.lender}: ${amount} for loan ${v.loanCode} has been sent to your MoMo wallet. Your first instalment is due on ${date}.`;
    case 'application.received':
      return `${v.lender}: we received your application ${v.applicationCode} for ${amount}. We will text you as soon as there is a decision.`;
    case 'offer.preapproved':
      return `${hello} You are pre-approved for a top-up of up to ${amount}. Open the ${v.lender} app to apply in 5 minutes.`;
    case 'checkin':
      return `${hello} Your next instalment on loan ${v.loanCode} is due on ${date}. If anything has changed for you, reply and we will find a plan together.`;
    case 'otp':
      return `${v.lender}: your sign-in code is ${v.code}. It expires in 5 minutes. Do not share it with anyone.`;
  }
}
