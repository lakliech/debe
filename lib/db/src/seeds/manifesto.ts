import { db } from "../index";
import { manifestoSectorsTable, faqItemsTable, badgeDefinitionsTable } from "../schema";
import { and, eq, isNull } from "drizzle-orm";

const SECTORS = [
  { slug: "agriculture", titleEn: "Agriculture & Food Security", titleSw: "Kilimo na Usalama wa Chakula", iconName: "Wheat", displayOrder: 1, descriptionEn: "Sustainable farming, modern irrigation, fair pricing for smallholder farmers, and food sovereignty for all Kenyans.", descriptionSw: "Kilimo endelevu, umwagiliaji wa kisasa, bei ya haki kwa wakulima wadogo, na uhuru wa chakula kwa Wakenya wote." },
  { slug: "health", titleEn: "Health & Well-being", titleSw: "Afya na Ustawi", iconName: "Heart", displayOrder: 2, descriptionEn: "Universal health coverage, affordable medicines, equipped public hospitals, and mental health services.", descriptionSw: "Chanjo ya afya kwa wote, dawa za bei nafuu, hospitali za umma zilizo na vifaa, na huduma za afya ya akili." },
  { slug: "education", titleEn: "Education & Skills", titleSw: "Elimu na Ujuzi", iconName: "GraduationCap", displayOrder: 3, descriptionEn: "Quality free public education, fully funded HELB, modern TVET institutions, and digital literacy for all.", descriptionSw: "Elimu bora ya umma bila malipo, HELB inayofadhiliwa kikamilifu, vyuo vya TVET vya kisasa, na ujuzi wa kidijitali kwa wote." },
  { slug: "infrastructure", titleEn: "Infrastructure & Transport", titleSw: "Miundombinu na Usafiri", iconName: "Building2", displayOrder: 4, descriptionEn: "Roads connecting every ward, affordable public transit, ports, rail, and digital infrastructure.", descriptionSw: "Barabara zinazounganisha kila wodi, usafiri wa umma wa bei nafuu, bandari, reli, na miundombinu ya kidijitali." },
  { slug: "economy", titleEn: "Economic Development & Jobs", titleSw: "Maendeleo ya Uchumi na Kazi", iconName: "TrendingUp", displayOrder: 5, descriptionEn: "SME support, industrialisation, job creation targets, and a business-friendly regulatory environment.", descriptionSw: "Msaada kwa SME, ukuaji wa viwanda, malengo ya uajiri, na mazingira mazuri ya biashara." },
  { slug: "energy", titleEn: "Energy & Natural Resources", titleSw: "Nishati na Rasilimali za Asili", iconName: "Zap", displayOrder: 6, descriptionEn: "100% renewable energy access, affordable electricity tariffs, and responsible resource extraction.", descriptionSw: "Upatikanaji wa nishati mbadala 100%, bei nafuu ya umeme, na uchimbaji wa rasilimali unaofaa." },
  { slug: "water", titleEn: "Water, Sanitation & Environment", titleSw: "Maji, Usafi na Mazingira", iconName: "Droplets", displayOrder: 7, descriptionEn: "Clean piped water to every home, sanitation for all, wetland conservation, and climate adaptation.", descriptionSw: "Maji safi kupitia bomba kwa kila nyumba, usafi kwa wote, uhifadhi wa maeneo oevu, na kubadilika kwa hali ya hewa." },
  { slug: "housing", titleEn: "Housing & Urban Development", titleSw: "Makazi na Maendeleo ya Miji", iconName: "Home", displayOrder: 8, descriptionEn: "Affordable housing programme, slum upgrading, planned urban development, and tenant protection laws.", descriptionSw: "Mpango wa makazi ya bei nafuu, uboreshaji wa maeneo duni, maendeleo ya miji yaliyopangwa, na sheria za ulinzi wa wapangaji." },
  { slug: "technology", titleEn: "Technology & Innovation", titleSw: "Teknolojia na Ubunifu", iconName: "Cpu", displayOrder: 9, descriptionEn: "Silicon Savannah investment, digital public services, open-source government, and AI ethics framework.", descriptionSw: "Uwekezaji wa Silicon Savannah, huduma za umma za kidijitali, serikali ya chanzo huria, na mfumo wa maadili ya AI." },
  { slug: "youth-sports", titleEn: "Youth Affairs & Sports", titleSw: "Masuala ya Vijana na Michezo", iconName: "Trophy", displayOrder: 10, descriptionEn: "Youth empowerment fund, sports academies, youth entrepreneurship hubs, and mental health support.", descriptionSw: "Mfuko wa uwezeshaji vijana, vyuo vya michezo, vituo vya ujasiriamali wa vijana, na msaada wa afya ya akili." },
  { slug: "social-protection", titleEn: "Social Protection", titleSw: "Ulinzi wa Kijamii", iconName: "Shield", displayOrder: 11, descriptionEn: "Expanded cash transfers, disability benefits, orphan support, and elderly dignified living programme.", descriptionSw: "Upanuzi wa uhamisho wa pesa taslimu, manufaa ya ulemavu, msaada wa yatima, na mpango wa maisha ya heshima kwa wazee." },
  { slug: "security-justice", titleEn: "Security & Justice", titleSw: "Usalama na Haki", iconName: "Scale", displayOrder: 12, descriptionEn: "Police reforms, community policing, fast-tracked justice, and an end to extrajudicial killings.", descriptionSw: "Mageuzi ya polisi, polisi wa jamii, haki ya haraka, na kukomesha mauaji ya ziada ya mahakama." },
  { slug: "governance", titleEn: "Governance & Anti-Corruption", titleSw: "Utawala na Kupambana na Ufisadi", iconName: "Landmark", displayOrder: 13, descriptionEn: "Zero tolerance to corruption, independent EACC, open budget tracking, and devolution deepening.", descriptionSw: "Kuvumilia sifuri kwa ufisadi, EACC huru, ufuatiliaji wa bajeti wazi, na kuimarisha ugatuzi." },
  { slug: "tourism", titleEn: "Tourism & Heritage", titleSw: "Utalii na Urithi", iconName: "MapPin", displayOrder: 14, descriptionEn: "Domestic tourism promotion, UNESCO heritage site investment, and creative economy support.", descriptionSw: "Ukuzaji wa utalii wa ndani, uwekezaji wa maeneo ya urithi ya UNESCO, na msaada wa uchumi wa ubunifu." },
  { slug: "trade", titleEn: "Trade & Industry", titleSw: "Biashara na Viwanda", iconName: "Package", displayOrder: 15, descriptionEn: "AfCFTA integration, Made-in-Kenya campaign, special economic zones, and export diversification.", descriptionSw: "Ujumuishaji wa AfCFTA, kampeni ya Kufanywa Kenya, maeneo maalum ya kiuchumi, na utofautishaji wa mauzo ya nje." },
  { slug: "women-gender", titleEn: "Gender Equity & Women's Rights", titleSw: "Usawa wa Jinsia na Haki za Wanawake", iconName: "Users", displayOrder: 16, descriptionEn: "Two-thirds gender rule enforcement, women's enterprise fund, GBV elimination, and equal pay legislation.", descriptionSw: "Utekelezaji wa sheria ya theluthi mbili, mfuko wa biashara za wanawake, uondoaji wa GBV, na sheria ya malipo sawa." },
  { slug: "disability", titleEn: "Disability & Special Needs", titleSw: "Ulemavu na Mahitaji Maalum", iconName: "Accessibility", displayOrder: 17, descriptionEn: "Inclusive public infrastructure, sign language in all schools, disability employment quotas, and assistive technology.", descriptionSw: "Miundombinu ya umma inayojumuisha wote, lugha ya ishara katika shule zote, vikwazo vya ajira kwa walemavu, na teknolojia ya msaada." },
  { slug: "foreign-policy", titleEn: "Foreign Policy & Diplomacy", titleSw: "Sera ya Nje na Diplomasia", iconName: "Globe", displayOrder: 18, descriptionEn: "Pan-African leadership, diaspora engagement, peaceful regional mediation, and trade-first diplomacy.", descriptionSw: "Uongozi wa Pan-Afrika, ushirikiano wa diaspora, upatanisho wa amani wa kikanda, na diplomasia inayozingatia biashara." },
  { slug: "culture", titleEn: "Culture, Arts & Heritage", titleSw: "Utamaduni, Sanaa na Urithi", iconName: "Music", displayOrder: 19, descriptionEn: "National arts fund, Kiswahili promotion, indigenous knowledge preservation, and creative industry support.", descriptionSw: "Mfuko wa sanaa wa taifa, ukuzaji wa Kiswahili, uhifadhi wa maarifa ya asili, na msaada wa sekta ya ubunifu." },
  { slug: "environment-climate", titleEn: "Environment & Climate Action", titleSw: "Mazingira na Hatua za Tabianchi", iconName: "Leaf", displayOrder: 20, descriptionEn: "NDC commitments, tree planting targets, plastic ban enforcement, and climate-resilient agriculture.", descriptionSw: "Ahadi za NDC, malengo ya kupanda miti, utekelezaji wa marufuku ya plastiki, na kilimo kinachostahimili tabianchi." },
];

const BADGES = [
  { name: "First Step", nameSw: "Hatua ya Kwanza", description: "Registered as a volunteer", level: "bronze", category: "onboarding", criteria: "Complete volunteer registration" },
  { name: "Trained & Ready", nameSw: "Mafunzo Kamili", description: "Completed all mandatory training courses", level: "silver", category: "training", criteria: "Pass all mandatory training modules" },
  { name: "Community Champion", nameSw: "Bingwa wa Jamii", description: "Registered 50+ supporters in your area", level: "gold", category: "recruitment", criteria: "Register 50 supporters" },
  { name: "Canvasser", nameSw: "Mwanahabari", description: "Completed 10 canvassing sessions", level: "bronze", category: "fieldwork", criteria: "Attend 10 canvassing activities" },
  { name: "Rally Mobiliser", nameSw: "Mwanzilishi wa Mkutano", description: "Helped mobilise 3+ rallies", level: "silver", category: "events", criteria: "Contribute to 3 rally events" },
  { name: "Polling Expert", nameSw: "Mtaalamu wa Kura", description: "Certified polling agent", level: "gold", category: "elections", criteria: "Complete polling agent training and be certified" },
  { name: "Digital Warrior", nameSw: "Shujaa wa Kidijitali", description: "Generated 1000+ online impressions for the campaign", level: "silver", category: "digital", criteria: "Verified 1000 campaign digital impressions" },
  { name: "County Coordinator", nameSw: "Mratibu wa Kaunti", description: "Appointed as county coordinator", level: "platinum", category: "leadership", criteria: "Be assigned county coordinator role" },
];

const FAQ_ITEMS = [
  { questionEn: "Who is Linda Mwananchi?", questionSw: "Ni nani Linda Mwananchi?", answerEn: "Linda Mwananchi is a 2027 presidential candidate committed to transformative governance, economic justice, and a better Kenya for all citizens.", answerSw: "Linda Mwananchi ni mgombea wa urais 2027 aliyejitolea kwa utawala wa mabadiliko, haki ya kiuchumi, na Kenya bora kwa raia wote.", category: "candidate", displayOrder: 1 },
  { questionEn: "How do I register as a volunteer?", questionSw: "Ninajisajilije kama kujitolea?", answerEn: "Click 'Count Me In' on the home page and fill out the volunteer registration form. A coordinator will contact you within 48 hours to complete verification.", answerSw: "Bonyeza 'Nihesabu' kwenye ukurasa wa nyumbani na ujaze fomu ya usajili wa kujitolea. Mratibu atawasiliana nawe ndani ya masaa 48 kukamilisha uthibitisho.", category: "volunteering", displayOrder: 1 },
  { questionEn: "How can I contribute financially to the campaign?", questionSw: "Ninawezaje kuchangia kifedha kwa kampeni?", answerEn: "You can donate via M-Pesa Paybill 3033049. Enter your phone number as the account number. Minimum contribution is KSh 50.", answerSw: "Unaweza kuchangia kupitia M-Pesa Paybill 3033049. Ingiza nambari yako ya simu kama nambari ya akaunti. Mchango wa chini ni KSh 50.", category: "donations", displayOrder: 1 },
  { questionEn: "What is the campaign's position on devolution?", questionSw: "Msimamo wa kampeni kuhusu ugatuzi ni upi?", answerEn: "We support deepening devolution — ensuring county governments receive adequate funding, have autonomy over local priorities, and are accountable to citizens.", answerSw: "Tunaunga mkono kuimarisha ugatuzi — kuhakikisha serikali za kaunti zinapata fedha za kutosha, zina uhuru juu ya vipaumbele vya ndani, na zinahusika na raia.", category: "policy", displayOrder: 1 },
  { questionEn: "How do I verify my voter registration?", questionSw: "Ninawezaje kuthibitisha usajili wangu wa kupiga kura?", answerEn: "Visit the IEBC website at iebc.or.ke or dial *860# on Safaricom to check your voter registration status.", answerSw: "Tembelea tovuti ya TAIBC katika iebc.or.ke au piga *860# kwenye Safaricom kuangalia hali yako ya usajili wa kupiga kura.", category: "voting", displayOrder: 1 },
  { questionEn: "Is my personal data safe with the campaign?", questionSw: "Je, data yangu ya kibinafsi iko salama na kampeni?", answerEn: "Yes. We comply fully with Kenya's Data Protection Act 2019. You may request access to, correction of, or deletion of your data at any time. We never sell your data.", answerSw: "Ndiyo. Tunazingatia kikamilifu Sheria ya Ulinzi wa Data ya Kenya ya 2019. Unaweza omba ufikiaji, marekebisho, au kufutwa kwa data yako wakati wowote. Hatuuzi data yako kamwe.", category: "privacy", displayOrder: 1 },
];

export async function seedManifesto() {
  console.log("Seeding manifesto sectors...");
  for (const sector of SECTORS) {
    // manifesto_sectors has no unique constraint on slug (platform-level rows
    // carry tenant_id NULL), so ON CONFLICT has no arbiter and errors out —
    // select the platform row, then update or insert.
    const [existing] = await db
      .select({ id: manifestoSectorsTable.id })
      .from(manifestoSectorsTable)
      .where(and(eq(manifestoSectorsTable.slug, sector.slug), isNull(manifestoSectorsTable.tenantId)))
      .limit(1);
    if (existing) {
      await db
        .update(manifestoSectorsTable)
        .set({ titleEn: sector.titleEn, titleSw: sector.titleSw, descriptionEn: sector.descriptionEn, descriptionSw: sector.descriptionSw, displayOrder: sector.displayOrder })
        .where(eq(manifestoSectorsTable.id, existing.id));
    } else {
      await db.insert(manifestoSectorsTable).values(sector);
    }
  }
  console.log(`✓ ${SECTORS.length} manifesto sectors seeded`);

  console.log("Seeding badge definitions...");
  for (const badge of BADGES) {
    await db.insert(badgeDefinitionsTable).values(badge).onConflictDoUpdate({
      target: badgeDefinitionsTable.name,
      set: { description: badge.description, level: badge.level, category: badge.category },
    });
  }
  console.log(`✓ ${BADGES.length} badge definitions seeded`);

  console.log("Seeding FAQ items...");
  await db.delete(faqItemsTable);
  await db.insert(faqItemsTable).values(
    FAQ_ITEMS.map((f, i) => ({ ...f, displayOrder: i + 1 }))
  );
  console.log(`✓ ${FAQ_ITEMS.length} FAQ items seeded`);
}
