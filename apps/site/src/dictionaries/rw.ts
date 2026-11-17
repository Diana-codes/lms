import type { Dictionary } from './en';

/**
 * Kinyarwanda copy for the public website.
 * TODO(BF): Have a native Kinyarwanda speaker review all text before launch.
 */
const rw: Dictionary = {
  slogans: {
    main: "Dutera imbuto y'igitekerezo cyawe.",
    trust: "Ibisubizo by'imari, byubakiye ku cyizere.",
    dream: 'Kuva mu nzozi ujya mu bikorwa.',
  },
  meta: {
    title: "Bridge to Finance — Dutera imbuto y'igitekerezo cyawe",
    description:
      "Inguzanyo, inama ku by'imari, gucunga imari na factoring mu Rwanda. Ibiciro bisobanutse, gusaba byoroshye, na serivisi mu Kinyarwanda no mu Cyongereza.",
  },
  nav: {
    home: 'Ahabanza',
    about: 'Abo turi bo',
    services: 'Serivisi',
    products: 'Inguzanyo',
    contact: 'Twandikire',
    login: 'Injira',
    apply: 'Saba ubu',
    menu: 'Fungura menyu',
    close: 'Funga menyu',
    skip: 'Jya ku bikubiye kuri uru rupapuro',
    language: 'Ururimi',
  },
  hero: {
    eyebrow: "Inguzanyo · Inama ku by'imari · Gucunga imari · Factoring",
    subtitle:
      "Dufasha abantu ku giti cyabo n'ibigo by'ubucuruzi kugera ku ntego zabo z'imari, tubaha ibisubizo by'imari byoroshye kubona n'inama z'inzobere.",
    primary: 'Menya serivisi zacu',
    secondary: 'Saba inguzanyo',
    points: [
      'Ibiciro byose ubimenya mbere yo gusinya',
      'Saba kuri interineti cyangwa ku biro byacu',
      'Mu Kinyarwanda no mu Cyongereza',
    ],
  },
  heroCard: {
    example: 'Urugero',
    application: "Ubusabe bw'inguzanyo",
    status: 'Burimo gusuzumwa',
    steps: ['Bwakiriwe', 'Burasuzumwa', 'Bwemejwe', 'Byatanzwe'],
    cashflow: "Incamake y'amafaranga yinjira",
    cashflowNote: 'Bishingiye ku mezi 6 ya Mobile Money',
    avgIncome: "Impuzandengo y'ayinjira buri kwezi",
    months: ['Gic', 'Kam', 'Nya', 'Kan', 'Nze', 'Ukw'],
  },
  stats: {
    services: 'Serivisi ahantu hamwe',
    term: "Amezi: igihe kirekire cy'inguzanyo",
    languages: "Indimi: Ikinyarwanda n'Icyongereza",
    hidden: 'Ikiguzi gihishe. Buri kiguzi kigaragazwa mbere',
  },
  showcase: {
    eyebrow: 'Kuri telefoni yawe',
    title: 'Imari yawe, ahantu hamwe.',
    text: 'Saba, ohereza inyandiko, kurikirana ubusabe bwawe kandi wishyure, byose ukoresheje telefoni yawe.',
    note: "Amashusho y'urugero y'urubuga rw'abakiriya ruzaza vuba.",
  },
  app: {
    greeting: 'Muraho, Aline',
    welcome: 'Murakaza neza',
    balance: 'Inguzanyo isigaye',
    repaid: 'byishyuwe',
    nextPayment: 'Ubwishyu bukurikira',
    due: 'Bitarenze 28 Ugushyingo',
    pay: 'Ishyura',
    schedule: 'Gahunda',
    documents: 'Inyandiko',
    help: 'Ubufasha',
    activity: 'Ibikorwa biheruka',
    momo: 'Kwishyura kuri Mobile Money',
    receipt: 'Inyemezabwishyu yoherejwe kuri SMS',
    paid: 'Byishyuwe',
    upcoming: 'Biraza',
    uploaded: 'Byoherejwe',
    docs: [
      'Indangamuntu',
      "Amafishi y'umushahara (amezi 3)",
      'Raporo ya Mobile Money',
      'Amasezerano yasinywe',
    ],
  },
  intro: {
    eyebrow: 'Ibyerekeye Bridge to Finance',
    body: "Bridge to Finance ni ikigo cy'u Rwanda gitanga serivisi z'imari. Dukorana n'abantu ku giti cyabo, ba rwiyemezamirimo n'ibigo bikura — kuva ku gitekerezo cya mbere kugeza ku ntambwe ikurikiraho — tubaha inguzanyo, inama n'imicungire y'imari ahantu hamwe.",
    values: [
      {
        title: 'Icyizere',
        text: "Amasezerano asobanutse, inama z'ukuri, n'ikiguzi cyose kigaragara neza.",
      },
      {
        title: 'Korohereza buri wese',
        text: 'Gusaba byoroshye kuri interineti, kuri telefoni cyangwa ku biro, mu rurimi uhisemo.',
      },
      {
        title: 'Ubufatanye',
        text: "Dukomeza kukuba hafi na nyuma y'inguzanyo, tukakugira inama uko imishinga yawe ikura.",
      },
    ],
  },
  services: {
    eyebrow: 'Serivisi zacu',
    title: 'Uburyo bune tugufasha gutera imbere',
    subtitle:
      'Waba ukeneye amafaranga, inama, cyangwa umufatanyabikorwa wo gucunga imari yawe, dufite serivisi ikubereye.',
    cta: 'Tuvugishe',
    items: {
      loans: {
        title: 'Inguzanyo',
        text: "Inguzanyo bwite, iz'abakozi, iz'ubucuruzi n'izo kugura ibikoresho, zifite gahunda yo kwishyura ijyanye n'ayo winjiza.",
      },
      advisory: {
        title: "Inama ku by'imari",
        text: "Igenamigambi ry'imari y'ubucuruzi n'inama zihariye zigufasha gufata ibyemezo wizeye.",
      },
      funds: {
        title: 'Gucunga imari',
        text: "Gucunga amafaranga mu buryo bw'umwuga, hakurikijwe amasezerano asobanutse, hamwe na raporo zihoraho.",
      },
      factoring: {
        title: 'Factoring',
        text: 'Hindura inyemezabuguzi zitarishyurwa amafaranga yo gukoresha, utarindiriye ko abakiriya bawe bishyura.',
      },
    },
  },
  products: {
    eyebrow: "Ubwoko bw'inguzanyo",
    title: 'Shaka inguzanyo ikubereye',
    subtitle:
      "Imibare igaragara ni iy'icyerekezo. Amafaranga n'igihe bya nyuma biterwa n'isuzuma ryawe.",
    amount: 'Amafaranga',
    term: 'Igihe',
    repayment: 'Kwishyura',
    apply: 'Saba',
    from: 'Kuva',
    upTo: 'kugeza',
    months: 'amezi',
    example: 'Urugero: {amount} mu mezi {term} ni nka {instalment} {per}, APR {apr}.',
    per: { WEEKLY: 'buri cyumweru', FORTNIGHTLY: 'buri byumweru bibiri', MONTHLY: 'buri kwezi' },
    frequency: {
      WEEKLY: 'Buri cyumweru',
      FORTNIGHTLY: 'Buri byumweru bibiri',
      MONTHLY: 'Buri kwezi',
    },
    kinds: {
      SME: 'Ku bucuruzi',
      PERSONAL: 'Ku bantu ku giti cyabo',
      AGRI: 'Ku bahinzi',
      ASSET: "Ku bantu ku giti cyabo n'ibigo",
    },
    note: "Imibare igaragara hano ni icyerekezo gusa, si icyemezo cy'inguzanyo. Ikiguzi cyose, harimo igipimo cy'ikiguzi cy'umwaka (APR), kigaragara mu Nyandiko y'Ingenzi (Key Facts Statement) mbere yo gusinya.",
    items: {
      salary: {
        name: "Inguzanyo y'abakozi",
        who: 'Ku bakozi bahembwa umushahara',
        text: 'Kemura ibyo ukeneye kandi wishyure mu byiciro bingana buri kwezi uvana ku mushahara.',
        repayment: 'Buri kwezi',
      },
      business: {
        name: "Inguzanyo y'ubucuruzi",
        who: "Ku bacuruzi n'ibigo bito",
        text: 'Ibicuruzwa, ibikoresho cyangwa igishoro cyo gukora, hashingiwe ku mafaranga ubucuruzi bwawe bwinjiza koko.',
        repayment: 'Buri kwezi',
      },
      group: {
        name: "Inguzanyo y'itsinda",
        who: "Ku matsinda y'abanyamuryango 5–20",
        text: 'Abanyamuryango barishingana, bigatuma inguzanyo iboneka nta ngwate.',
        repayment: 'Buri cyumweru cyangwa buri kwezi',
      },
      asset: {
        name: 'Inguzanyo yo kugura ibikoresho',
        who: "Ku bantu ku giti cyabo n'ibigo",
        text: 'Gura imodoka, imashini cyangwa ibikoresho, icyo uguze kikaba ingwate.',
        repayment: 'Buri kwezi',
      },
      emergency: {
        name: 'Inguzanyo yihutirwa',
        who: 'Ku bakiriya basanzwe',
        text: 'Amafaranga yihuse igihe hari ikibaye utari witeze, yishyurwa mu mezi 1 kugeza kuri 3.',
        repayment: 'Buri kwezi',
      },
      personal: {
        name: "Inguzanyo y'umuntu ku giti cye",
        who: 'Ku bantu ku giti cyabo',
        text: "Amafaranga y'ishuri, gusana inzu cyangwa ibikenewe mu muryango, yishyurwa mu byiciro bingana buri kwezi.",
        repayment: 'Buri kwezi',
      },
      agri: {
        name: "Inguzanyo y'inyongeramusaruro",
        who: 'Ku bahinzi',
        text: "Imbuto, ifumbire n'inyongeramusaruro z'igihembwe, byishyurwa nyuma y'isarura.",
        repayment: 'Buri kwezi',
      },
    },
  },
  why: {
    eyebrow: 'Impamvu Bridge to Finance',
    title: "Ubunyamwuga bw'ikigo cy'imari, n'umutima wita ku muntu",
    items: [
      {
        title: 'Nta kiguzi gihishe',
        text: "Mbere yo gusinya, uhabwa Inyandiko y'Ingenzi igaragaza buri kiguzi, ikiguzi cyose hamwe na APR.",
      },
      {
        title: "Nta fishi y'umushahara? Nta kibazo",
        text: "Abacuruzi n'abikorera bashobora gusaba bakoresheje raporo za konti ya banki cyangwa iza Mobile Money.",
      },
      {
        title: 'Kurikirana buri ntambwe',
        text: "Kurikirana ubusabe bwawe, ibyo wishyuye n'ibyo usigaje kuri interineti, igihe cyose.",
      },
      {
        title: 'Kwishyura byoroshye',
        text: 'Ishyura ukoresheje Mobile Money cyangwa banki, kandi uhabwe inyemezabwishyu kuri buri bwishyu.',
      },
      {
        title: 'Mu rurimi rwawe',
        text: "Serivisi, inyandiko n'ubutumwa mu Kinyarwanda cyangwa mu Cyongereza.",
      },
      {
        title: 'Amakuru yawe arinzwe',
        text: "Amakuru yawe abikwa neza kandi akoreshwa gusa uko itegeko ry'u Rwanda rirengera amakuru bwite ribiteganya.",
      },
    ],
  },
  how: {
    eyebrow: 'Uko bikorwa',
    title: 'Kuva ku busabe kugeza ku mafaranga mu ntambwe enye',
    steps: [
      {
        title: 'Saba',
        text: 'Saba kuri interineti mu minota mike, cyangwa uze ku biro byacu.',
      },
      {
        title: 'Ohereza inyandiko',
        text: "Ohereza indangamuntu n'amafishi y'umushahara cyangwa raporo za konti ukoresheje telefoni yawe.",
      },
      {
        title: 'Habwa igisubizo',
        text: 'Itsinda ryacu risuzuma ubusabe bwawe kandi rikakumenyesha amakuru kuri SMS.',
      },
      {
        title: 'Akira kandi wishyure',
        text: 'Sinya amasezerano, wakire amafaranga, kandi wishyure ukurikije gahunda isobanutse.',
      },
    ],
  },
  cta: {
    title: "Witeguye gutera imbuto y'igitekerezo cyawe?",
    text: "Saba inguzanyo uyu munsi, cyangwa uvugane n'umujyanama ku bikubereye.",
    primary: 'Saba inguzanyo',
    secondary: "Vugana n'umujyanama",
  },
  contact: {
    eyebrow: 'Twandikire',
    title: 'Turi hano ngo tugufashe',
    text: 'Twoherereze ubutumwa, itsinda ryacu rizagusubiza vuba bishoboka.',
    visit: 'Dusure',
    call: 'Duhamagare',
    email: 'Imeyili',
    hours: "Amasaha y'akazi",
    hoursValue: 'Kuwa mbere–Kuwa gatanu, 8:00–17:00',
    form: {
      fullName: 'Amazina yombi',
      phone: 'Nimero ya telefoni',
      email: 'Imeyili (si ngombwa)',
      service: 'Serivisi ushaka',
      servicePlaceholder: 'Hitamo serivisi',
      subject: 'Icyo ubutumwa bwerekeyeho',
      message: 'Ubutumwa',
      consent:
        'Nemeye ko Bridge to Finance ikoresha aya makuru kugira ngo isubize ubutumwa bwanjye.',
      submit: 'Ohereza ubutumwa',
      sending: 'Birimo koherezwa…',
      success: 'Murakoze. Ubutumwa bwanyu bwakiriwe, itsinda ryacu rizabavugisha vuba.',
      errors: {
        required: 'Uzuza aha, ni ngombwa.',
        phone: 'Andika nimero ya telefoni yo mu Rwanda yemewe.',
        email: 'Andika imeyili yemewe.',
        consent: 'Emeza kugira ngo ukomeze.',
        generic: 'Habaye ikibazo. Ongera ugerageze cyangwa uduhamagare.',
      },
    },
  },
  footer: {
    services: 'Serivisi',
    company: 'Ikigo',
    legal: 'Amategeko',
    privacy: 'Itangazo ku makuru bwite',
    terms: "Amabwiriza y'imikoreshereze",
    complaints: 'Ibirego',
    regulated: "Igenzurwa na Banki Nkuru y'u Rwanda.",
    licence: 'Uruhushya no.',
    rights: 'Uburenganzira bwose burasigasiwe.',
  },
  login: {
    title: 'Injira',
    subtitle: 'Hitamo uko ushaka kwinjira.',
    customer: "Urubuga rw'abakiriya",
    customerText: "Cunga ubusabe bwawe, inguzanyo n'ibyo wishyura.",
    staff: "Urubuga rw'abakozi",
    staffText: 'Ku bakozi ba Bridge to Finance.',
    soon: 'Biraza vuba',
    back: 'Subira ahabanza',
  },
};

export default rw;
