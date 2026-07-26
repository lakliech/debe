/**
 * Content seed — manifesto items, news articles, fact-check items, events.
 * Run: pnpm --filter @workspace/scripts run seed:content
 */
import { db } from "@workspace/db";
import {
  manifestoItemsTable,
  newsArticlesTable,
  factCheckItemsTable,
  eventsTable,
} from "@workspace/db";

// ─── Sector IDs (from DB) ─────────────────────────────────────────────────────
const SECTORS: Record<string, string> = {
  agriculture:       "586d5e8a-ad30-4c9b-b71f-e285ceecb316",
  health:            "3ffea47f-eecc-453f-a58f-0c8c9575234e",
  education:         "6d11b0ed-5229-4820-b6f5-de337c8e90bb",
  infrastructure:    "28e2318f-f6e4-4e88-8f5c-88f4ecb29ed1",
  economy:           "b82e6e8b-bda3-4432-9cae-e66fb04b01bb",
  energy:            "e21f5844-6ea1-45cd-b9b3-61b5bdf7d721",
  water:             "4fa5a679-48a1-4963-bc83-5fa53c9759c9",
  housing:           "55c6949f-d1dd-4713-928b-eb2f2600ca75",
  technology:        "88797b82-3cd4-4155-9825-59dc25deb1d5",
  youth:             "a944b307-40d8-49fb-83ff-168e42786cdb",
  socialProtection:  "eb6cf760-b1f5-4987-a3a6-41eaf0b57a18",
  security:          "a3139669-dc4e-4e5c-8279-10e2ea31d87a",
  governance:        "ab1b418e-69ee-4d0e-80c0-92253c212e4f",
  tourism:           "d9749352-0a2b-4d43-936a-3b0244d56929",
  trade:             "3879f876-2068-435e-92fa-b00f5b6e6c8b",
  gender:            "19ed7360-2ec1-4ad8-9fce-f8a78234cb7c",
  disability:        "e018b875-d922-4fd0-94c2-c5ddb72bc015",
  foreignPolicy:     "bca09bb7-3bb2-46e2-bcaf-6660b3503f06",
  culture:           "3f1d6196-036a-4a33-8436-a98b207cb7dd",
  environment:       "e26b43dd-229e-4b99-aad0-1afd9fde9985",
};

// ─── Manifesto Items ──────────────────────────────────────────────────────────
const MANIFESTO_ITEMS = [
  // Agriculture
  { sectorId: SECTORS.agriculture, priority: 1,
    titleEn: "Subsidised fertiliser for smallholder farmers",
    titleSw: "Mbolea ya ruzuku kwa wakulima wadogo",
    bodyEn: "Provide a 50% government subsidy on certified fertiliser for farms under 5 acres, reaching 3 million smallholders by 2026.",
    bodySw: "Kutoa ruzuku ya asilimia 50 ya serikali kwenye mbolea iliyoidhinishwa kwa mashamba chini ya ekari 5, kufikia wakulima wadogo milioni 3 ifikapo 2026." },
  { sectorId: SECTORS.agriculture, priority: 2,
    titleEn: "Guaranteed minimum price for maize and beans",
    titleSw: "Bei ya chini iliyohakikishiwa kwa mahindi na maharagwe",
    bodyEn: "Establish a strategic grain reserve and guaranteed farm-gate price floor for maize (KES 4,500/90kg bag) and beans (KES 12,000/90kg bag).",
    bodySw: "Kuanzisha akiba ya mkakati ya nafaka na kiwango cha chini cha bei ya shamba kwa mahindi (KES 4,500/mfuko wa kg 90) na maharagwe (KES 12,000/mfuko wa kg 90)." },
  { sectorId: SECTORS.agriculture, priority: 3,
    titleEn: "Last-mile irrigation for arid and semi-arid counties",
    titleSw: "Umwagiliaji wa mwisho kwa kaunti kame na nusu kame",
    bodyEn: "Roll out solar-powered drip irrigation to 200,000 hectares in ASAL counties, reducing dependence on rain-fed farming.",
    bodySw: "Kueneza umwagiliaji wa matone unaotumia nishati ya jua katika hekta 200,000 katika kaunti za ASAL, kupunguza utegemezi wa kilimo cha mvua." },
  { sectorId: SECTORS.agriculture, priority: 4,
    titleEn: "Digital commodity exchange for fair market prices",
    titleSw: "Soko la kidijitali la bidhaa kwa bei ya haki",
    bodyEn: "Launch a mobile-first agricultural commodities exchange allowing farmers to sell directly to certified buyers, eliminating exploitative middlemen.",
    bodySw: "Kuzindua soko la bidhaa za kilimo la kwanza la simu kuruhusu wakulima kuuza moja kwa moja kwa wanunuzi walioidhinishwa, kuondoa wachuuzi wanaonyanyasa." },

  // Health
  { sectorId: SECTORS.health, priority: 1,
    titleEn: "Universal Health Coverage for all Kenyans",
    titleSw: "Bima ya Afya kwa Wakenya Wote",
    bodyEn: "Enrol every Kenyan household in a public health insurance scheme funded through progressive taxation, replacing the failed NHIF model.",
    bodySw: "Kuandikisha kila kaya ya Kenya katika mpango wa bima ya afya ya umma unaoungwa mkono na ushuru wa maendeleo, ukichukua nafasi ya mfano wa NHIF ulioshindwa." },
  { sectorId: SECTORS.health, priority: 2,
    titleEn: "One fully-equipped health centre per ward",
    titleSw: "Kituo kimoja cha afya chenye vifaa kamili kwa kila kata",
    bodyEn: "Construct or upgrade one Level 3 health facility per ward, each with a maternity unit, laboratory, and 24-hour emergency care.",
    bodySw: "Kujenga au kuboresha kituo kimoja cha afya cha Kiwango cha 3 kwa kila kata, kila kimoja na kitengo cha uzazi, maabara, na huduma ya dharura ya saa 24." },
  { sectorId: SECTORS.health, priority: 3,
    titleEn: "Free maternal and child health services",
    titleSw: "Huduma za bure za afya ya mama na mtoto",
    bodyEn: "Abolish all user fees for antenatal care, delivery, postnatal care, and immunisation at all public facilities.",
    bodySw: "Kufuta ada zote za mtumiaji kwa huduma za ujauzito, kujifungua, huduma baada ya kuzaa, na chanjo katika vituo vyote vya umma." },
  { sectorId: SECTORS.health, priority: 4,
    titleEn: "Mental health integration into primary care",
    titleSw: "Ujumuishaji wa afya ya akili katika huduma za msingi",
    bodyEn: "Train 10,000 community health workers in mental health first aid and deploy at least one psychiatric nurse per health centre by 2027.",
    bodySw: "Kufunza wafanyakazi 10,000 wa afya ya jamii katika huduma za kwanza za afya ya akili na kupeleka angalau muuguzi mmoja wa akili kwa kila kituo cha afya ifikapo 2027." },

  // Education
  { sectorId: SECTORS.education, priority: 1,
    titleEn: "Fully-funded CBC implementation with competency-based assessment",
    titleSw: "Utekelezaji wa CBC uliofadhiliwa kikamilifu na tathmini ya uwezo",
    bodyEn: "Provide KES 120 billion over four years to fully equip schools, retrain teachers, and develop Kenya-specific CBC learning materials.",
    bodySw: "Kutoa KES bilioni 120 kwa miaka minne ili kuimarisha kikamilifu shule, kuwapatia walimu mafunzo upya, na kutengeneza vifaa vya kujifunza vya CBC vinavyohusu Kenya." },
  { sectorId: SECTORS.education, priority: 2,
    titleEn: "Free school meals for all public primary pupils",
    titleSw: "Chakula cha bure shuleni kwa wanafunzi wote wa shule za msingi za umma",
    bodyEn: "Expand the school feeding programme to cover all 10 million public primary school learners using locally sourced produce.",
    bodySw: "Kupanua programu ya kulisha shuleni ili kufunika wanafunzi wote milioni 10 wa shule za msingi za umma kwa kutumia mazao ya ndani." },
  { sectorId: SECTORS.education, priority: 3,
    titleEn: "TVET scholarship fund for 500,000 youth per year",
    titleSw: "Mfuko wa ufadhili wa TVET kwa vijana 500,000 kwa mwaka",
    bodyEn: "Create a competitive scholarship scheme for Technical and Vocational Education, targeting artisans, mechanics, plumbers, electricians, and coders.",
    bodySw: "Kuunda mpango wa ushindani wa ufadhili wa Elimu ya Kiufundi na Ufundi, ukilenga mafundi, mekanikas, mafundi mabomba, mafundi umeme, na wasimbuaji." },

  // Infrastructure
  { sectorId: SECTORS.infrastructure, priority: 1,
    titleEn: "10,000 km of all-weather rural roads by 2030",
    titleSw: "Km 10,000 za barabara za vijijini zinazopitika wakati wote ifikapo 2030",
    bodyEn: "Rehabilitate and upgrade rural roads with all-weather surfaces, prioritising agricultural corridors linking farms to markets.",
    bodySw: "Kukarabati na kuboresha barabara za vijijini na uso unaopitika wakati wote, ukizingatia njia za kilimo zinazounganisha mashamba na masoko." },
  { sectorId: SECTORS.infrastructure, priority: 2,
    titleEn: "Standard Gauge Railway extension to Kisumu and Malaba",
    titleSw: "Upanuzi wa Reli ya Gauge ya Kawaida hadi Kisumu na Malaba",
    bodyEn: "Complete the SGR western extension to Kisumu by 2027 and Malaba border by 2029, unlocking the East African economic corridor.",
    bodySw: "Kukamilisha upanuzi wa SGR magharibi hadi Kisumu ifikapo 2027 na mpaka wa Malaba ifikapo 2029, ukifungua njia ya kiuchumi ya Afrika Mashariki." },

  // Economy & Jobs
  { sectorId: SECTORS.economy, priority: 1,
    titleEn: "Create 1 million formal jobs annually through SME support",
    titleSw: "Kuunda kazi rasmi milioni 1 kwa mwaka kupitia usaidizi wa SME",
    bodyEn: "Establish a KES 50 billion SME Development Fund offering single-digit interest loans, business mentorship, and market access support.",
    bodySw: "Kuanzisha Mfuko wa Maendeleo ya SME wa KES bilioni 50 unaotoa mikopo ya faida ya tarakimu moja, ushauri wa biashara, na usaidizi wa upatikanaji wa soko." },
  { sectorId: SECTORS.economy, priority: 2,
    titleEn: "Reduce corporate tax for job-creating manufacturers",
    titleSw: "Kupunguza kodi ya kampuni kwa wazalishaji wanaounda kazi",
    bodyEn: "Cut corporate tax from 30% to 20% for manufacturers that maintain a workforce of over 50 Kenyans and source at least 40% of raw materials locally.",
    bodySw: "Kupunguza kodi ya kampuni kutoka asilimia 30 hadi asilimia 20 kwa wazalishaji wanaohifadhi nguvu kazi ya zaidi ya Wakenya 50 na kununua angalau asilimia 40 ya malighafi ndani ya nchi." },
  { sectorId: SECTORS.economy, priority: 3,
    titleEn: "Nairobi as East Africa's premier financial hub",
    titleSw: "Nairobi kama kitovu cha kwanza cha fedha cha Afrika Mashariki",
    bodyEn: "Streamline licencing, cut bureaucratic red tape, and position Kenya as the preferred destination for fintech, private equity, and impact investment in Africa.",
    bodySw: "Kurahisisha utoaji wa leseni, kupunguza urasimu wa kiofisi, na kuweka Kenya kama mahali penye upendeleo kwa fintech, hisa za kibinafsi, na uwekezaji wa athari barani Afrika." },

  // Energy
  { sectorId: SECTORS.energy, priority: 1,
    titleEn: "100% renewable electricity by 2030",
    titleSw: "Umeme wa nishati mbadala asilimia 100 ifikapo 2030",
    bodyEn: "Invest KES 400 billion in geothermal, solar, and wind capacity to eliminate fossil fuel dependency in the national grid.",
    bodySw: "Kuwekeza KES bilioni 400 katika uwezo wa jotoardhi, jua, na upepo ili kuondoa utegemezi wa mafuta ya visukuku kwenye gridi ya taifa." },
  { sectorId: SECTORS.energy, priority: 2,
    titleEn: "Last-mile rural electrification for every household",
    titleSw: "Umeme wa mwisho wa vijijini kwa kila kaya",
    bodyEn: "Connect the remaining 3 million un-electrified rural households through solar home systems and mini-grid technology by 2027.",
    bodySw: "Kuunganisha kaya milioni 3 za vijijini zisizo na umeme zilizobaki kupitia mifumo ya nyumba ya jua na teknolojia ya gridi ndogo ifikapo 2027." },

  // Water & Sanitation
  { sectorId: SECTORS.water, priority: 1,
    titleEn: "Safe drinking water within 1 km for all Kenyans",
    titleSw: "Maji salama ya kunywa ndani ya km 1 kwa Wakenya wote",
    bodyEn: "Drill and equip 10,000 boreholes in water-stressed areas, each serving a radius of 1 km, achieving universal safe water access by 2028.",
    bodySw: "Kuchimba na kuimarisha visima 10,000 katika maeneo yenye uhaba wa maji, kila kimoja kikihudumia eneo la km 1, kufikia upatikanaji wa maji salama kwa wote ifikapo 2028." },
  { sectorId: SECTORS.water, priority: 2,
    titleEn: "Open defecation-free Kenya by 2027",
    titleSw: "Kenya huru ya haja wazi ifikapo 2027",
    bodyEn: "Provide subsidised sanitation facilities to 4 million households and mandate school latrine construction ratios of 1:25 for girls.",
    bodySw: "Kutoa vifaa vya usafi wa mazingira vya ruzuku kwa kaya milioni 4 na kuzingatia uwiano wa ujenzi wa vyoo vya shule vya 1:25 kwa wasichana." },

  // Technology
  { sectorId: SECTORS.technology, priority: 1,
    titleEn: "National broadband rollout: fibre to every ward",
    titleSw: "Mpango wa kitaifa wa broadband: nyuzinyuzi kwa kila kata",
    bodyEn: "Lay 100,000 km of fibre optic cable and subsidise last-mile connectivity to bring high-speed internet to every Kenyan ward by 2028.",
    bodySw: "Kuweka km 100,000 za kebo ya nyuzinyuzi ya macho na kuchangia muunganisho wa mwisho kuleta intaneti ya kasi ya juu kwa kila kata ya Kenya ifikapo 2028." },
  { sectorId: SECTORS.technology, priority: 2,
    titleEn: "Digital government: all services online within 18 months",
    titleSw: "Serikali ya kidijitali: huduma zote mtandaoni ndani ya miezi 18",
    bodyEn: "Migrate all 1,200+ government services to a unified digital portal accessible via mobile, eliminating physical queues and reducing corruption touchpoints.",
    bodySw: "Kuhamisha huduma zote 1,200+ za serikali kwenye tovuti moja ya kidijitali inayopatikana kupitia simu, kuondoa foleni za kimwili na kupunguza maeneo ya rushwa." },
  { sectorId: SECTORS.technology, priority: 3,
    titleEn: "Silicon Savannah 2.0: 50,000 tech jobs by 2027",
    titleSw: "Silicon Savannah 2.0: kazi 50,000 za teknolojia ifikapo 2027",
    bodyEn: "Expand the Konza Technopolis masterplan, fund 100 startup incubators countrywide, and waive import duty on technology equipment for registered startups.",
    bodySw: "Kupanua mpango mkuu wa Konza Technopolis, kufadhili vituo 100 vya kuanzisha biashara nchi nzima, na kuondoa ushuru wa kuingiza kwa vifaa vya teknolojia kwa makampuni mapya yaliyosajiliwa." },

  // Governance & Anti-Corruption
  { sectorId: SECTORS.governance, priority: 1,
    titleEn: "Independent anti-corruption court with fast-track trials",
    titleSw: "Mahakama huru ya kupambana na rushwa yenye kesi za haraka",
    bodyEn: "Establish a specialised Economic and Corruption Court with dedicated prosecutors and a 180-day trial timeline for corruption cases above KES 10 million.",
    bodySw: "Kuanzisha Mahakama ya Kiuchumi na Rushwa ya utaalamu wenye washtaki waliowekwa na ratiba ya siku 180 za kesi kwa kesi za rushwa zaidi ya KES milioni 10." },
  { sectorId: SECTORS.governance, priority: 2,
    titleEn: "Publish all government contracts above KES 1 million",
    titleSw: "Kuchapisha mikataba yote ya serikali zaidi ya KES milioni 1",
    bodyEn: "Mandate full disclosure of all government procurement contracts, beneficial ownership information, and audit reports on an open-data portal.",
    bodySw: "Kuamuru ufunuo kamili wa mikataba yote ya ununuzi wa serikali, taarifa za umiliki wa manufaa, na ripoti za ukaguzi kwenye tovuti ya data wazi." },
  { sectorId: SECTORS.governance, priority: 3,
    titleEn: "Reduce Cabinet size to a lean 18 ministries",
    titleSw: "Kupunguza ukubwa wa Baraza la Mawaziri hadi wizara nyembamba 18",
    bodyEn: "Rationalise government to 18 focused ministries, cutting the public wage bill by KES 80 billion annually and eliminating duplicated functions.",
    bodySw: "Kurekebisha serikali kuwa wizara 18 zinazozingatia mambo maalum, kupunguza bili ya mishahara ya umma kwa KES bilioni 80 kwa mwaka na kuondoa kazi zinazofanana." },

  // Gender
  { sectorId: SECTORS.gender, priority: 1,
    titleEn: "Two-thirds gender rule enforced at all levels",
    titleSw: "Kanuni ya theluthi mbili ya kijinsia itekelezwe katika ngazi zote",
    bodyEn: "Enact legislation to enforce the two-thirds gender principle in all public appointments, boards, and elected positions by 2025.",
    bodySw: "Kutunga sheria ya kutekeleza kanuni ya theluthi mbili ya kijinsia katika uteuzi wote wa umma, bodi, na nafasi za uchaguzi ifikapo 2025." },
  { sectorId: SECTORS.gender, priority: 2,
    titleEn: "End gender-based violence through specialised GBV courts",
    titleSw: "Kumaliza unyanyasaji wa kijinsia kupitia mahakama maalum za GBV",
    bodyEn: "Establish 47 county-level GBV courts with female-majority benches, mandatory shelter referrals, and survivor protection orders enforceable within 24 hours.",
    bodySw: "Kuanzisha mahakama za GBV katika ngazi ya kaunti 47 zenye madawati ya wengi wa wanawake, rufaa za makazi za lazima, na amri za ulinzi wa walionusurika zinazotekelezwa ndani ya masaa 24." },

  // Environment & Climate
  { sectorId: SECTORS.environment, priority: 1,
    titleEn: "Plant 15 billion trees by 2030",
    titleSw: "Kupanda miti bilioni 15 ifikapo 2030",
    bodyEn: "Mobilise every Kenyan household, school, and business to plant trees in a national afforestation programme targeting 10% forest cover by 2030.",
    bodySw: "Kuhamasisha kila kaya, shule, na biashara ya Kenya kupanda miti katika programu ya kitaifa ya upandaji miti inayolenga asilimia 10 ya msitu ifikapo 2030." },
  { sectorId: SECTORS.environment, priority: 2,
    titleEn: "Single-use plastic ban with green jobs creation",
    titleSw: "Marufuku ya plastiki ya matumizi ya mara moja na uundaji wa kazi za kijani",
    bodyEn: "Fully enforce the plastic bag ban, extend it to all single-use plastics, and fund 50,000 green jobs in recycling and waste management.",
    bodySw: "Kutekeleza kikamilifu marufuku ya mfuko wa plastiki, kuipanua hadi plastiki zote za matumizi ya mara moja, na kufadhili kazi 50,000 za kijani katika usindikaji na usimamizi wa taka." },

  // Social Protection
  { sectorId: SECTORS.socialProtection, priority: 1,
    titleEn: "Expand cash transfers to 2 million vulnerable households",
    titleSw: "Kupanua uhamisho wa pesa kwa kaya milioni 2 zilizo hatarini",
    bodyEn: "Double the Inua Jamii cash transfer programme to reach 2 million of the poorest households with KES 4,000 per month, indexed to inflation.",
    bodySw: "Kuongeza mara mbili programu ya uhamisho wa pesa ya Inua Jamii kufikia kaya milioni 2 maskini zaidi kwa KES 4,000 kwa mwezi, ikiwa na uhusiano na mfumuko wa bei." },

  // Youth
  { sectorId: SECTORS.youth, priority: 1,
    titleEn: "Youth Enterprise Fund: KES 50,000 to 1 million youth",
    titleSw: "Mfuko wa Biashara ya Vijana: KES 50,000 kwa vijana milioni 1",
    bodyEn: "Reform and fully fund the Youth Enterprise Development Fund to disburse KES 50,000 seed grants to one million young entrepreneurs, interest-free for 2 years.",
    bodySw: "Kurekebisha na kufadhili kikamilifu Mfuko wa Maendeleo ya Biashara ya Vijana kutuma ruzuku za mbegu za KES 50,000 kwa vijana wajasiriamali milioni moja, bila faida kwa miaka 2." },
  { sectorId: SECTORS.youth, priority: 2,
    titleEn: "National Youth Service reform and expansion",
    titleSw: "Marekebisho na upanuzi wa Huduma ya Vijana ya Taifa",
    bodyEn: "Rebuild NYS as a world-class skills and leadership academy, enrolling 200,000 youth annually in 18-month programmes combining technical training with national service.",
    bodySw: "Kujenga upya NYS kama chuo cha ujuzi na uongozi wa daraja la kwanza duniani, kuandikisha vijana 200,000 kwa mwaka katika programu za miezi 18 zinazounganisha mafunzo ya kiufundi na huduma ya kitaifa." },

  // Security
  { sectorId: SECTORS.security, priority: 1,
    titleEn: "Community policing: 10,000 new officers in marginalised areas",
    titleSw: "Polisi wa jamii: maafisa 10,000 wapya katika maeneo ya pembezoni",
    bodyEn: "Hire and deploy 10,000 additional police officers with priority to marginalised and insecure counties, with mandatory community policing certification.",
    bodySw: "Kuajiri na kupeleka maafisa wa polisi 10,000 wa ziada wakizingatia kaunti zilizo pembezoni na zisizo salama, na cheti cha lazima cha polisi wa jamii." },
];

// ─── News Articles ─────────────────────────────────────────────────────────────
const NEWS_ARTICLES = [
  {
    slug: "linda-mwananchi-launches-2027-campaign",
    category: "campaign",
    titleEn: "Linda Mwananchi Officially Launches 2027 Presidential Campaign",
    titleSw: "Linda Mwananchi Rasmi Azindua Kampeni ya Urais ya 2027",
    excerptEn: "In a historic rally at Uhuru Park attended by over 200,000 Kenyans, Linda Mwananchi declared her candidacy for the 2027 presidential election.",
    excerptSw: "Katika mkutano mkubwa wa kihistoria katika Uhuru Park uliohudhuriwa na Wakenya zaidi ya 200,000, Linda Mwananchi alitangaza kugombea uchaguzi wa urais wa 2027.",
    bodyEn: `In a historic rally at Uhuru Park attended by over 200,000 Kenyans from all 47 counties, Linda Mwananchi officially declared her candidacy for the 2027 presidential election under the banner of "It's Time."

Speaking to a charged crowd that spilled into Haile Selassie Avenue, Mwananchi outlined a bold 10-point agenda: universal healthcare, free school meals, 1 million new jobs annually, renewable energy for all, and zero tolerance for corruption.

"Kenya does not lack resources. Kenya lacks leaders who put the people first. I am running to change that," she told the crowd, drawing a thunderous response.

The rally marked the formal start of what analysts are calling the most well-organised grassroots campaign in Kenya's post-independence history, with 47 county structures already operational and over 60,000 trained volunteers ready to mobilise.`,
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-01-15T10:00:00Z"),
  },
  {
    slug: "manifesto-health-pillar-unveiled",
    category: "policy",
    titleEn: "Full Health Manifesto Unveiled: UHC for Every Kenyan by 2026",
    titleSw: "Ilani Kamili ya Afya Imefunuliwa: UHC kwa Kila Mkenya ifikapo 2026",
    excerptEn: "The Linda Mwananchi campaign released a detailed health manifesto promising universal health coverage, one health centre per ward, and free maternal care.",
    excerptSw: "Kampeni ya Linda Mwananchi ilitoa ilani ya kina ya afya ikiahidi bima ya afya kwa wote, kituo kimoja cha afya kwa kila kata, na huduma ya bure ya uzazi.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-02-03T09:00:00Z"),
    bodyEn: `The Linda Mwananchi 2027 Campaign today unveiled the most comprehensive health manifesto ever produced by a Kenyan presidential candidate, covering universal health coverage, infrastructure, mental health, and maternal care.

Key pledges include:
- Enrolling every Kenyan household in a publicly-funded health insurance scheme by 2026
- Constructing or upgrading one Level 3 health facility per ward, complete with maternity units and 24-hour emergency care
- Abolishing all user fees for maternal and child health services
- Deploying psychiatric nurses to every health centre

"Access to healthcare is not a privilege. It is a constitutional right, and we intend to enforce it," said Campaign Policy Director Dr. Amina Hassan at the Nairobi Press Club briefing.

The manifesto was developed over 18 months through consultations with 4,200 healthcare workers, community health volunteers, and county health officials across all 47 counties.`,
  },
  {
    slug: "economic-plan-one-million-jobs",
    category: "policy",
    titleEn: "The Jobs Plan: How We Will Create 1 Million Formal Jobs Every Year",
    titleSw: "Mpango wa Kazi: Jinsi Tutakavyounda Kazi Rasmi Milioni 1 Kila Mwaka",
    excerptEn: "A KES 50 billion SME fund, tax cuts for manufacturers, and the Nairobi financial hub strategy form the core of the campaign's economic blueprint.",
    excerptSw: "Mfuko wa SME wa KES bilioni 50, kupunguza kodi kwa wazalishaji, na mkakati wa kitovu cha fedha cha Nairobi ni msingi wa mpango wa kiuchumi wa kampeni.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-02-20T11:00:00Z"),
    bodyEn: `The Linda Mwananchi Campaign today launched a detailed economic blueprint projecting the creation of one million formal jobs annually through a combination of SME support, manufacturing incentives, and financial sector reforms.

The three-pillar strategy includes:

**Pillar 1 – SME Development Fund (KES 50 Billion)**
A revolving fund offering single-digit interest loans of between KES 500,000 and KES 10 million to registered small businesses, paired with a nationwide network of 300 business mentorship centres.

**Pillar 2 – Manufacturing Tax Reform**
Corporate tax reduced from 30% to 20% for manufacturers employing more than 50 Kenyans and sourcing 40% of raw materials locally, expected to attract KES 200 billion in domestic manufacturing investment.

**Pillar 3 – Nairobi as Africa's Financial Capital**
Streamlined licencing, a dedicated financial innovation sandbox, and double taxation treaties with 30 new countries to position Nairobi as the continent's premier fintech and investment hub.

"Unemployment is not inevitable. It is a policy choice. We choose jobs," said Mwananchi at the launch at the Kenya International Conference Centre.`,
  },
  {
    slug: "linda-mwananchi-western-kenya-tour",
    category: "campaign",
    titleEn: "Mwananchi Draws Record Crowds Across Western Kenya",
    titleSw: "Mwananchi Avutia Umati wa Rekodi Katika Magharibi mwa Kenya",
    excerptEn: "A five-day campaign tour through Kisumu, Kakamega, Bungoma, and Busia drew an estimated 800,000 Kenyans, making it the largest campaign mobilisation in the region's history.",
    excerptSw: "Ziara ya kampeni ya siku tano kupitia Kisumu, Kakamega, Bungoma, na Busia ilivutia Wakenya wapatao 800,000, na kufanya iwe ukusanyaji mkubwa zaidi wa kampeni katika historia ya eneo.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-03-10T14:00:00Z"),
    bodyEn: `Linda Mwananchi's Western Kenya Campaign Tour concluded yesterday after five consecutive days of mass rallies across the region, drawing crowds estimated at over 800,000 by independent observers.

Highlights included:
- A beach rally at Dunga, Kisumu, where she announced the SGR extension to Kisumu and Malaba border by 2027 and 2029 respectively
- A farmers' forum in Kakamega where she pledged to eliminate exploitative middlemen through a mobile commodities exchange
- A youth summit in Bungoma attended by over 15,000 young people

"Western Kenya is not a vote bank — it is a partner in building a new Kenya," she told the crowd in Busia.

The tour also included unannounced visits to Matayos Sub-District Hospital and Malaba border post, where she held candid conversations with healthcare workers and cross-border traders.`,
  },
  {
    slug: "anti-corruption-court-statement",
    category: "policy",
    titleEn: "Statement: We Will Establish an Independent Anti-Corruption Court on Day One",
    titleSw: "Taarifa: Tutaanzisha Mahakama Huru ya Kupambana na Rushwa Siku ya Kwanza",
    excerptEn: "The campaign reaffirms its commitment to establish a specialised Economic and Corruption Court with a 180-day trial timeline for cases above KES 10 million.",
    excerptSw: "Kampeni inathibitisha tena azma yake ya kuanzisha Mahakama ya Kiuchumi na Rushwa ya utaalamu wenye ratiba ya siku 180 za kesi zaidi ya KES milioni 10.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-03-25T08:00:00Z"),
    bodyEn: `The Linda Mwananchi 2027 Campaign reaffirms its non-negotiable commitment to establish an Independent Economic and Corruption Court within the first 100 days of a Mwananchi administration.

The court will feature:
- Judges vetted through an independent process with civil society participation
- Dedicated public prosecutors with security of tenure
- A mandatory 180-day trial timeline for corruption cases exceeding KES 10 million
- Asset recovery units operating in collaboration with the Financial Reporting Centre and Ethics and Anti-Corruption Commission

"Not one shilling of public money stolen from Kenyans will rest easy under a Mwananchi government. We will hunt it, recover it, and imprison those responsible," said Mwananchi in a statement released today.

The campaign also committed to publishing all government contracts above KES 1 million on a public open-data portal within 30 days of taking office.`,
  },
  {
    slug: "environment-tree-planting-pledge",
    category: "policy",
    titleEn: "15 Billion Trees by 2030: Kenya's Green Future Starts Now",
    titleSw: "Miti Bilioni 15 ifikapo 2030: Mustakabali wa Kijani wa Kenya Unaanza Sasa",
    excerptEn: "Linda Mwananchi pledges to mobilise every Kenyan household, school and business in a national afforestation programme targeting 10% forest cover.",
    excerptSw: "Linda Mwananchi anaahidi kuhamasisha kila kaya, shule na biashara ya Kenya katika programu ya kitaifa ya upandaji miti inayolenga asilimia 10 ya msitu.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-04-05T09:30:00Z"),
    bodyEn: `In a commitment described by environmentalists as the most ambitious climate pledge in Kenyan political history, Linda Mwananchi has promised to plant 15 billion trees by 2030.

The programme would mobilise:
- Every Kenyan school (planting 5 trees per pupil per year)
- Every household (minimum 2 trees per year on their land)
- All county governments (with environmental performance bonuses)
- Corporate Kenya through a Green Corporate Compliance framework

The goal is to restore Kenya's forest cover from the current 7.2% to 10% by 2030, and 15% by 2035.

"Climate change is not coming — it is here. The floods in Tana River, the drought in Turkana, the disappearing glaciers on Mount Kenya — these are not acts of God. They are the consequence of decades of deforestation and inaction. We stop that today," said Mwananchi at the World Environment Day rally in Karura Forest, Nairobi.`,
  },
  {
    slug: "press-release-debate-challenge",
    category: "press_release",
    titleEn: "Press Release: Mwananchi Challenges All Presidential Candidates to Six Public Debates",
    titleSw: "Taarifa kwa Vyombo vya Habari: Mwananchi Awataka Wagombea Wote wa Urais Midahalo Sita ya Umma",
    excerptEn: "The campaign formally challenges all declared presidential candidates to participate in six nationally televised debates covering the economy, healthcare, security, agriculture, youth, and governance.",
    excerptSw: "Kampeni rasmi inawataka wagombea wote waliojitangaza wa urais kushiriki katika midahalo sita ya kitaifa iliyoonyeshwa kwenye runinga inayohusiana na uchumi, afya, usalama, kilimo, vijana, na uongozi.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-04-18T07:00:00Z"),
    bodyEn: `FOR IMMEDIATE RELEASE
Linda Mwananchi 2027 Campaign
Date: April 18, 2026

The Linda Mwananchi 2027 Presidential Campaign today formally challenges all declared and prospective presidential candidates to six nationally televised public debates, to be held between September 2026 and January 2027.

Proposed debate schedule and themes:
1. The Economy & Jobs – September 2026
2. Healthcare & Social Protection – October 2026
3. Security, Justice & Anti-Corruption – November 2026
4. Agriculture, Food Security & Environment – December 2026
5. Youth, Education & Technology – January 2027
6. Governance, Devolution & Foreign Policy – January 2027

"Democracy is served by transparency and accountability, not by hiding from the public. We call on our colleagues to face Kenyans directly and answer for their records and their plans," said Campaign Spokesperson Patricia Waweru.

Media organisations interested in partnering to host any of the proposed debates are invited to contact the campaign at debates@lindamwananchi.ke.

— END —`,
  },
  {
    slug: "women-leaders-manifesto-endorsement",
    category: "campaign",
    titleEn: "500 Women Leaders Endorse Mwananchi Manifesto at National Women's Convention",
    titleSw: "Viongozi 500 wa Wanawake Waidhinisha Ilani ya Mwananchi katika Mkutano wa Kitaifa wa Wanawake",
    excerptEn: "Delegates representing women's organisations from all 47 counties formally endorsed the Mwananchi 2027 manifesto at a convention in Nairobi, citing the gender equity and maternal health pledges.",
    excerptSw: "Wajumbe wanawakilisha mashirika ya wanawake kutoka kaunti zote 47 rasmi waliidhinisha ilani ya Mwananchi 2027 katika mkutano huko Nairobi, wakitaja ahadi za usawa wa kijinsia na afya ya uzazi.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-05-02T12:00:00Z"),
    bodyEn: `Over 500 women leaders representing grassroots organisations, professional bodies, and county women's chapters from all 47 counties formally endorsed the Linda Mwananchi 2027 manifesto at the Bomas of Kenya on Friday.

The endorsement resolution, signed by convention chair Rose Makena, cited seven specific manifesto commitments that delegates said "represent the most concrete and costed gender agenda ever presented by a Kenyan presidential candidate":

1. Enforcement of the two-thirds gender rule at all appointment levels
2. 47 dedicated GBV courts with survivor protection orders
3. Free maternal and child health services at all public facilities
4. Mandatory 40% women's representation on all state boards
5. A KES 10 billion Women's Enterprise Fund with 0% interest
6. Land registration reform ensuring joint spousal titling
7. Mandatory menstrual hygiene products in all public schools

"We are not just endorsing a candidate. We are endorsing a Kenya where a woman does not have to choose between her safety and her dignity," said Makena.`,
  },
  {
    slug: "uhc-pilot-counties-announcement",
    category: "policy",
    titleEn: "UHC Pilot: Mwananchi Reveals Which Four Counties Will Launch First",
    titleSw: "Mkakati wa UHC: Mwananchi Afunua Kaunti Nne Zitakazozinduliwa Kwanza",
    excerptEn: "Homa Bay, Turkana, Kilifi, and Marsabit have been named as the initial counties for the Universal Health Coverage pilot, chosen based on disease burden and infrastructure gaps.",
    excerptSw: "Homa Bay, Turkana, Kilifi, na Marsabit zimeitajwa kuwa kaunti za awali za mpango wa jaribio wa UHC, zilizochaguliwa kulingana na mzigo wa magonjwa na mapengo ya miundombinu.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-05-20T10:00:00Z"),
    bodyEn: `The Linda Mwananchi 2027 Campaign has announced that Homa Bay, Turkana, Kilifi, and Marsabit counties have been identified as the first four counties where Universal Health Coverage will be operationalised within the first 90 days of a Mwananchi presidency.

The selection criteria included:
- Highest maternal mortality rates nationally
- Lowest public health facility density
- Highest percentage of out-of-pocket healthcare expenditure
- Existing county government capacity to absorb rapid investment

"We are not starting where it is easiest. We are starting where the need is greatest," said Dr. Hassan.

Each pilot county will receive:
- A dedicated UHC implementation team
- Upgraded Level 4 county referral hospitals
- 150 new community health workers per county
- Mobile clinics for hard-to-reach areas`,
  },
  {
    slug: "opinion-devolution-must-be-funded",
    category: "opinion",
    titleEn: "Opinion: Devolution Will Only Succeed When We Give It Enough Money",
    titleSw: "Maoni: Ugatuzi Utafanikiwa Tu Tunapompa Pesa za Kutosha",
    excerptEn: "Campaign Policy Director Dr. Amina Hassan argues that the single greatest threat to devolution is inadequate equitable share — and promises to raise it to 35% of national revenue.",
    excerptSw: "Mkurugenzi wa Sera ya Kampeni Dk. Amina Hassan anasema tishio kubwa zaidi kwa ugatuzi ni sehemu ndogo ya usawa — na anaahidi kuiinua hadi asilimia 35 ya mapato ya kitaifa.",
    imageUrl: null,
    status: "published",
    publishedAt: new Date("2026-06-01T08:00:00Z"),
    bodyEn: `By Dr. Amina Hassan, Director of Policy, Linda Mwananchi 2027 Campaign

Kenya's devolution experiment is one of the most promising governance innovations on the African continent. But it is being strangled by underfunding.

The Constitution mandates a minimum 15% equitable share of national revenue to counties. In practice, the national government has dragged its feet, delayed disbursements, and treated counties as administrative units rather than autonomous governments.

The Linda Mwananchi administration will raise the equitable share to 35% of national revenue — the highest in Kenya's history — and legally guarantee quarterly disbursements with automatic penalties for delay.

This is not charity. It is constitutional obligation. And it is smart economics: every shilling invested in county governments returns an average of KES 2.80 in local economic activity, according to the Institute of Economic Affairs.

We believe in devolution not as a political arrangement but as a development model. And we will fund it like one.`,
  },
];

// ─── Fact-Check Items ─────────────────────────────────────────────────────────
const FACT_CHECK_ITEMS = [
  {
    claimEn: "Linda Mwananchi was born in Tanzania and is not constitutionally eligible to run for President.",
    claimSw: "Linda Mwananchi alizaliwa Tanzania na hana haki ya kikatiba ya kugombea Urais.",
    rating: "FALSE",
    verdictEn: "FALSE. Linda Mwananchi was born in Kisumu, Kenya. Her birth certificate, national ID, and Kenya Certificate of Secondary Education records all confirm Kenyan birth. This claim has been circulated repeatedly and has been debunked by the Independent Electoral and Boundaries Commission.",
    verdictSw: "UONGO. Linda Mwananchi alizaliwa Kisumu, Kenya. Cheti chake cha kuzaliwa, kitambulisho cha taifa, na rekodi za KCSE zinathibitisha kuzaliwa Kenya. Dai hili limetawanywa mara nyingi na limekanusha na Tume ya Huru ya Uchaguzi na Mipaka.",
    sourceUrl: "https://www.iebc.or.ke",
    publishedAt: new Date("2026-02-10T09:00:00Z"),
  },
  {
    claimEn: "The Linda Mwananchi campaign receives funding from foreign governments seeking to control Kenya's foreign policy.",
    claimSw: "Kampeni ya Linda Mwananchi inapokea ufadhili kutoka kwa serikali za kigeni zinazotafuta kudhibiti sera za kigeni za Kenya.",
    rating: "FALSE",
    verdictEn: "FALSE. The campaign's financial disclosures filed with the IEBC show no foreign government donations. All disclosed donors are Kenyan citizens and registered Kenyan companies. This claim appears to originate from anonymous social media accounts with no supporting evidence.",
    verdictSw: "UONGO. Ufunuo wa fedha wa kampeni uliwasilishwa kwa IEBC hauonyeshi michango ya serikali za kigeni. Wafadhili wote waliofunuliwa ni raia wa Kenya na makampuni ya Kenya yaliyosajiliwa. Dai hili linaonekana kutoka kwenye akaunti za mitandao ya kijamii bila ushahidi wa kuunga mkono.",
    sourceUrl: null,
    publishedAt: new Date("2026-02-28T11:00:00Z"),
  },
  {
    claimEn: "Mwananchi's UHC plan would require raising VAT to 25% to fund it.",
    claimSw: "Mpango wa UHC wa Mwananchi utahitaji kuinua VAT hadi asilimia 25 kuufadhili.",
    rating: "FALSE",
    verdictEn: "FALSE. The campaign's published costing model funds UHC through a combination of: (1) redirecting existing NHIF contributions to a new public scheme, (2) progressive income tax adjustments for top earners, and (3) reducing corruption-related procurement losses by an estimated KES 200 billion annually. No VAT increase is proposed.",
    verdictSw: "UONGO. Mfano wa gharama uliochapishwa wa kampeni unafadhili UHC kupitia mchanganyiko wa: (1) kuelekeza upya mchango wa NHIF uliopo kwenye mpango mpya wa umma, (2) marekebisho ya kodi ya mapato ya maendeleo kwa wanaopata juu, na (3) kupunguza hasara za ununuzi zinazohusiana na rushwa kwa takriban KES bilioni 200 kwa mwaka. Hakuna ongezeko la VAT lililopendekezwa.",
    sourceUrl: null,
    publishedAt: new Date("2026-03-14T10:00:00Z"),
  },
  {
    claimEn: "The campaign promised to abolish devolution and return to a centralised government.",
    claimSw: "Kampeni iliahidi kufuta ugatuzi na kurudi kwa serikali kuu.",
    rating: "FALSE",
    verdictEn: "FALSE. This is the complete opposite of the campaign's position. The Linda Mwananchi manifesto explicitly commits to raising the county equitable share from 15% to 35% and expanding county governments' legislative and fiscal autonomy. No statement by the campaign supports the claim of abolishing devolution.",
    verdictSw: "UONGO. Hii ni kinyume kabisa na msimamo wa kampeni. Ilani ya Linda Mwananchi waziwazi inaahidi kuinua sehemu ya usawa ya kaunti kutoka asilimia 15 hadi asilimia 35 na kupanua uhuru wa kisheria na wa fedha wa serikali za kaunti. Hakuna taarifa yoyote ya kampeni inayounga mkono dai la kufuta ugatuzi.",
    sourceUrl: null,
    publishedAt: new Date("2026-03-30T09:00:00Z"),
  },
  {
    claimEn: "Linda Mwananchi's economic plan will drive Kenya into debt of over KES 10 trillion.",
    claimSw: "Mpango wa kiuchumi wa Linda Mwananchi utaingiza Kenya kwenye deni la zaidi ya KES trilioni 10.",
    rating: "MISLEADING",
    verdictEn: "MISLEADING. The claim selectively quotes total campaign spending commitments over 5 years without accounting for: (1) corresponding revenue measures, (2) GDP growth projections that expand the tax base, and (3) savings from anti-corruption reforms. The Institute of Economic Affairs reviewed the plan and found it consistent with fiscal sustainability at a debt-to-GDP ratio of 58% — within the IMF's recommended 60% threshold for developing economies.",
    verdictSw: "UPOTOSHAJI. Dai hili linanukuliwa kwa upendeleo na jumla ya ahadi za matumizi ya kampeni kwa miaka 5 bila kuzingatia: (1) hatua za mapato zinazohusiana, (2) makadirio ya ukuaji wa Pato la Taifa yanayopanua msingi wa ushuru, na (3) akiba kutoka kwa mageuzi ya kupambana na rushwa. Taasisi ya Mambo ya Kiuchumi iliukagua mpango na kuukuta unafanana na uendelevu wa fedha kwa uwiano wa deni kwa Pato la Taifa wa asilimia 58 — ndani ya kizingiti kilichopendekezwa cha IMF cha asilimia 60 kwa nchi zinazoendelea.",
    sourceUrl: null,
    publishedAt: new Date("2026-04-22T10:30:00Z"),
  },
  {
    claimEn: "Linda Mwananchi previously supported the Finance Bill 2024 before opposing it publicly.",
    claimSw: "Linda Mwananchi alikuwa amesaidia Mswada wa Fedha wa 2024 kabla ya kupinga hadharani.",
    rating: "FALSE",
    verdictEn: "FALSE. Parliamentary voting records and public statements clearly show that Mwananchi was among the first public figures to call for the withdrawal of Finance Bill 2024, issuing a statement on June 14, 2024 — three days before the major Gen-Z protests. No record of prior support for the bill exists.",
    verdictSw: "UONGO. Rekodi za upigaji kura wa Bunge na taarifa za umma zinaonyesha wazi kwamba Mwananchi alikuwa miongoni mwa takwimu za kwanza za umma kutaka kuondolewa kwa Mswada wa Fedha wa 2024, akitoa taarifa mnamo Juni 14, 2024 — siku tatu kabla ya maandamano makubwa ya Gen-Z. Hakuna rekodi ya usaidizi wake wa awali wa mswada.",
    sourceUrl: null,
    publishedAt: new Date("2026-05-10T08:00:00Z"),
  },
  {
    claimEn: "The campaign's manifesto was written by a foreign consultancy firm, not Kenyan policy experts.",
    claimSw: "Ilani ya kampeni iliandikwa na kampuni ya ushauri ya kigeni, si wataalamu wa sera wa Kenya.",
    rating: "FALSE",
    verdictEn: "FALSE. The manifesto was authored by a team of 47 Kenyan policy experts — one per county theme — drawn from universities, civil society, and sector specialist backgrounds. A full list of contributors was published on the campaign website at launch. The only international input was a peer-review process conducted by three African governance institutes, none of which were paid consultants.",
    verdictSw: "UONGO. Ilani iliandikwa na timu ya wataalamu wa sera wa Kenya 47 — mmoja kwa kila mada ya kaunti — kutoka vyuo vikuu, jumuiya ya kiraia, na asili ya wataalamu wa sekta. Orodha kamili ya wachangiaji ilichapishwa kwenye tovuti ya kampeni wakati wa kuzinduliwa. Mchango pekee wa kimataifa ulikuwa mchakato wa mapitio ya rika uliofanywa na taasisi tatu za utawala wa Afrika, ambazo hakuna iliyokuwa mshauri aliyelipwa.",
    sourceUrl: null,
    publishedAt: new Date("2026-06-05T09:00:00Z"),
  },
];

// ─── Events ────────────────────────────────────────────────────────────────────
const EVENTS = [
  {
    title: "National Campaign Launch Rally — Uhuru Park, Nairobi",
    description: "Join us for the official Linda Mwananchi 2027 presidential campaign launch rally. Free entry. All Kenyans welcome.",
    venue: "Uhuru Park, Nairobi",
    eventDate: "2026-08-15",
    startTime: "10:00",
    status: "published",
    eventType: "rally",
    expectedAttendance: 200000,
  },
  {
    title: "Manifesto Public Forum — Kisumu",
    description: "An open public forum to discuss the Mwananchi 2027 manifesto pledges for Nyanza region. Bring your questions and ideas.",
    venue: "Jomo Kenyatta Sports Ground, Kisumu",
    eventDate: "2026-08-22",
    startTime: "14:00",
    status: "published",
    eventType: "forum",
    expectedAttendance: 5000,
  },
  {
    title: "Youth Jobs Summit — University of Nairobi",
    description: "A dedicated summit on the campaign's youth employment agenda: the KES 50,000 seed grant, NYS reform, and the Silicon Savannah 2.0 plan. Open to students, graduates, and young entrepreneurs.",
    venue: "UoN Main Campus, JKML Hall, Nairobi",
    eventDate: "2026-09-05",
    startTime: "09:00",
    status: "published",
    eventType: "summit",
    expectedAttendance: 2000,
  },
  {
    title: "Women's Town Hall — Mombasa",
    description: "A women-only town hall meeting to discuss the gender equity manifesto commitments, the GBV court pledge, and the Women's Enterprise Fund.",
    venue: "Mama Ngina Cultural Centre, Mombasa",
    eventDate: "2026-09-12",
    startTime: "10:00",
    status: "published",
    eventType: "town_hall",
    expectedAttendance: 1000,
  },
  {
    title: "Farmers' Forum — Eldoret",
    description: "Open dialogue with farmers on the agriculture manifesto: subsidised fertiliser, guaranteed prices for maize and beans, and the digital commodity exchange.",
    venue: "Eldoret Agricultural Show Grounds, Eldoret",
    eventDate: "2026-09-20",
    startTime: "09:30",
    status: "published",
    eventType: "forum",
    expectedAttendance: 3000,
  },
  {
    title: "Health Manifesto Town Hall — Nakuru",
    description: "Healthcare workers, patients, and community members invited to a detailed discussion on the Universal Health Coverage pledge and the one-health-centre-per-ward commitment.",
    venue: "Nakuru War Memorial Hospital Grounds, Nakuru",
    eventDate: "2026-10-04",
    startTime: "11:00",
    status: "published",
    eventType: "town_hall",
    expectedAttendance: 1500,
  },
  {
    title: "Devolution & Governance Forum — Garissa",
    description: "A cross-county forum on devolution, the equitable share increase to 35%, and the anti-corruption court pledge. County governors and MCAs invited.",
    venue: "Garissa University, Garissa",
    eventDate: "2026-10-18",
    startTime: "10:00",
    status: "published",
    eventType: "forum",
    expectedAttendance: 800,
  },
  {
    title: "Technology & Innovation Summit — Konza Technopolis",
    description: "Kenya's tech ecosystem convenes to discuss Silicon Savannah 2.0, the digital government plan, and the national broadband rollout. Startups, investors, and policy makers welcome.",
    venue: "Konza Technopolis, Machakos County",
    eventDate: "2026-11-07",
    startTime: "08:30",
    status: "published",
    eventType: "summit",
    expectedAttendance: 2500,
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Seeding content...\n");

  // Manifesto items
  console.log(`Inserting ${MANIFESTO_ITEMS.length} manifesto items...`);
  for (const item of MANIFESTO_ITEMS) {
    await db.insert(manifestoItemsTable).values(item).onConflictDoNothing();
  }
  console.log("  ✓ Manifesto items done");

  // News articles
  console.log(`Inserting ${NEWS_ARTICLES.length} news articles...`);
  for (const article of NEWS_ARTICLES) {
    await db.insert(newsArticlesTable).values(article as any).onConflictDoNothing();
  }
  console.log("  ✓ News articles done");

  // Fact-check items
  console.log(`Inserting ${FACT_CHECK_ITEMS.length} fact-check items...`);
  for (const item of FACT_CHECK_ITEMS) {
    await db.insert(factCheckItemsTable).values(item as any).onConflictDoNothing();
  }
  console.log("  ✓ Fact-check items done");

  // Events
  console.log(`Inserting ${EVENTS.length} events...`);
  for (const event of EVENTS) {
    await db.insert(eventsTable).values(event as any).onConflictDoNothing();
  }
  console.log("  ✓ Events done");

  console.log("\nContent seed complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
