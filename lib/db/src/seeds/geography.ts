import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "../index";
import { countiesTable, constituenciesTable, wardsTable } from "../schema";

interface _WardJson { name: string; pollingStations: { name: string }[] }
interface _ConstJson { name: string; wards: _WardJson[] }
interface _CountyJson { name: string; constituencies: _ConstJson[] }
const _dir = dirname(fileURLToPath(import.meta.url));
const _countyData: _CountyJson[] = JSON.parse(
  readFileSync(join(_dir, "county_data.json"), "utf-8"),
);

// All 47 counties with approximate coordinates
export const COUNTIES = [
  { code: 1, name: "Mombasa", capital: "Mombasa", latitude: -4.0435, longitude: 39.6682, registeredVoters: 534408 },
  { code: 2, name: "Kwale", capital: "Kwale", latitude: -4.1728, longitude: 39.4524, registeredVoters: 346578 },
  { code: 3, name: "Kilifi", capital: "Kilifi", latitude: -3.5107, longitude: 39.9093, registeredVoters: 538028 },
  { code: 4, name: "Tana River", capital: "Hola", latitude: -1.4979, longitude: 40.0281, registeredVoters: 152437 },
  { code: 5, name: "Lamu", capital: "Lamu", latitude: -2.2686, longitude: 40.9020, registeredVoters: 75163 },
  { code: 6, name: "Taita-Taveta", capital: "Voi", latitude: -3.3967, longitude: 38.5543, registeredVoters: 199611 },
  { code: 7, name: "Garissa", capital: "Garissa", latitude: -0.4532, longitude: 42.1403, registeredVoters: 260598 },
  { code: 8, name: "Wajir", capital: "Wajir", latitude: 1.7471, longitude: 40.0573, registeredVoters: 272421 },
  { code: 9, name: "Mandera", capital: "Mandera", latitude: 3.9366, longitude: 41.8670, registeredVoters: 337765 },
  { code: 10, name: "Marsabit", capital: "Marsabit", latitude: 2.3284, longitude: 37.9899, registeredVoters: 200491 },
  { code: 11, name: "Isiolo", capital: "Isiolo", latitude: 0.3523, longitude: 37.5827, registeredVoters: 110929 },
  { code: 12, name: "Meru", capital: "Meru", latitude: 0.0472, longitude: 37.6491, registeredVoters: 690673 },
  { code: 13, name: "Tharaka-Nithi", capital: "Chuka", latitude: -0.2969, longitude: 37.6474, registeredVoters: 246888 },
  { code: 14, name: "Embu", capital: "Embu", latitude: -0.5273, longitude: 37.4508, registeredVoters: 310028 },
  { code: 15, name: "Kitui", capital: "Kitui", latitude: -1.3667, longitude: 38.0167, registeredVoters: 545706 },
  { code: 16, name: "Machakos", capital: "Machakos", latitude: -1.5177, longitude: 37.2634, registeredVoters: 632929 },
  { code: 17, name: "Makueni", capital: "Wote", latitude: -2.2559, longitude: 37.8955, registeredVoters: 463697 },
  { code: 18, name: "Nyandarua", capital: "Ol Kalou", latitude: -0.3837, longitude: 36.5779, registeredVoters: 354649 },
  { code: 19, name: "Nyeri", capital: "Nyeri", latitude: -0.4167, longitude: 36.9500, registeredVoters: 434978 },
  { code: 20, name: "Kirinyaga", capital: "Kerugoya", latitude: -0.4945, longitude: 37.2822, registeredVoters: 312736 },
  { code: 21, name: "Murang'a", capital: "Murang'a", latitude: -0.7180, longitude: 37.1488, registeredVoters: 508552 },
  { code: 22, name: "Kiambu", capital: "Kiambu", latitude: -1.0313, longitude: 36.8318, registeredVoters: 1159167 },
  { code: 23, name: "Turkana", capital: "Lodwar", latitude: 3.1193, longitude: 35.5966, registeredVoters: 421044 },
  { code: 24, name: "West Pokot", capital: "Kapenguria", latitude: 1.2389, longitude: 35.1128, registeredVoters: 237083 },
  { code: 25, name: "Samburu", capital: "Maralal", latitude: 1.0985, longitude: 36.6993, registeredVoters: 138386 },
  { code: 26, name: "Trans Nzoia", capital: "Kitale", latitude: 1.0180, longitude: 35.0062, registeredVoters: 432832 },
  { code: 27, name: "Uasin Gishu", capital: "Eldoret", latitude: 0.5143, longitude: 35.2698, registeredVoters: 597618 },
  { code: 28, name: "Elgeyo Marakwet", capital: "Iten", latitude: 0.6718, longitude: 35.5085, registeredVoters: 213773 },
  { code: 29, name: "Nandi", capital: "Kapsabet", latitude: 0.2009, longitude: 35.0982, registeredVoters: 380459 },
  { code: 30, name: "Baringo", capital: "Kabarnet", latitude: 0.4912, longitude: 35.7426, registeredVoters: 297694 },
  { code: 31, name: "Laikipia", capital: "Nanyuki", latitude: 0.0046, longitude: 36.9519, registeredVoters: 278553 },
  { code: 32, name: "Nakuru", capital: "Nakuru", latitude: -0.3031, longitude: 36.0800, registeredVoters: 900060 },
  { code: 33, name: "Narok", capital: "Narok", latitude: -1.0820, longitude: 35.8690, registeredVoters: 444900 },
  { code: 34, name: "Kajiado", capital: "Kajiado", latitude: -1.8521, longitude: 36.7765, registeredVoters: 527060 },
  { code: 35, name: "Kericho", capital: "Kericho", latitude: -0.3685, longitude: 35.2863, registeredVoters: 374813 },
  { code: 36, name: "Bomet", capital: "Bomet", latitude: -0.7897, longitude: 35.3401, registeredVoters: 338649 },
  { code: 37, name: "Kakamega", capital: "Kakamega", latitude: 0.2827, longitude: 34.7519, registeredVoters: 742693 },
  { code: 38, name: "Vihiga", capital: "Mbale", latitude: 0.0675, longitude: 34.7234, registeredVoters: 259946 },
  { code: 39, name: "Bungoma", capital: "Bungoma", latitude: 0.5635, longitude: 34.5606, registeredVoters: 614793 },
  { code: 40, name: "Busia", capital: "Busia", latitude: 0.4608, longitude: 34.1116, registeredVoters: 336785 },
  { code: 41, name: "Siaya", capital: "Siaya", latitude: 0.0611, longitude: 34.2883, registeredVoters: 457834 },
  { code: 42, name: "Kisumu", capital: "Kisumu", latitude: -0.0917, longitude: 34.7679, registeredVoters: 565912 },
  { code: 43, name: "Homa Bay", capital: "Homa Bay", latitude: -0.5273, longitude: 34.4571, registeredVoters: 471753 },
  { code: 44, name: "Migori", capital: "Migori", latitude: -1.0634, longitude: 34.4731, registeredVoters: 504213 },
  { code: 45, name: "Kisii", capital: "Kisii", latitude: -0.6817, longitude: 34.7666, registeredVoters: 584485 },
  { code: 46, name: "Nyamira", capital: "Nyamira", latitude: -0.5673, longitude: 34.9358, registeredVoters: 307553 },
  { code: 47, name: "Nairobi", capital: "Nairobi", latitude: -1.2921, longitude: 36.8219, registeredVoters: 2278468 },
] as const;

// Constituencies per county (code → list of constituency names)
// This is a representative subset; full data would have all 290 constituencies
export const CONSTITUENCY_DATA: Record<number, { code: number; name: string }[]> = {
  1: [ // Mombasa
    { code: 1, name: "Changamwe" }, { code: 2, name: "Jomvu" }, { code: 3, name: "Kisauni" },
    { code: 4, name: "Nyali" }, { code: 5, name: "Likoni" }, { code: 6, name: "Mvita" },
  ],
  2: [ // Kwale
    { code: 7, name: "Msambweni" }, { code: 8, name: "Lungalunga" }, { code: 9, name: "Matuga" }, { code: 10, name: "Kinango" },
  ],
  3: [ // Kilifi
    { code: 11, name: "Kilifi North" }, { code: 12, name: "Kilifi South" }, { code: 13, name: "Kaloleni" },
    { code: 14, name: "Rabai" }, { code: 15, name: "Ganze" }, { code: 16, name: "Malindi" }, { code: 17, name: "Magarini" },
  ],
  4: [ // Tana River
    { code: 18, name: "Garsen" }, { code: 19, name: "Galole" }, { code: 20, name: "Bura" },
  ],
  5: [ // Lamu
    { code: 21, name: "Lamu East" }, { code: 22, name: "Lamu West" },
  ],
  6: [ // Taita-Taveta
    { code: 23, name: "Taveta" }, { code: 24, name: "Wundanyi" }, { code: 25, name: "Mwatate" }, { code: 26, name: "Voi" },
  ],
  7: [ // Garissa
    { code: 27, name: "Garissa Township" }, { code: 28, name: "Balambala" }, { code: 29, name: "Lagdera" },
    { code: 30, name: "Dadaab" }, { code: 31, name: "Fafi" }, { code: 32, name: "Ijara" },
  ],
  8: [ // Wajir
    { code: 33, name: "Wajir North" }, { code: 34, name: "Wajir East" }, { code: 35, name: "Tarbaj" },
    { code: 36, name: "Wajir West" }, { code: 37, name: "Eldas" }, { code: 38, name: "Wajir South" },
  ],
  9: [ // Mandera
    { code: 39, name: "Mandera North" }, { code: 40, name: "Banissa" }, { code: 41, name: "Mandera East" },
    { code: 42, name: "Lafey" }, { code: 43, name: "Mandera West" }, { code: 44, name: "Mandera South" },
  ],
  10: [ // Marsabit
    { code: 45, name: "Moyale" }, { code: 46, name: "North Horr" }, { code: 47, name: "Saku" }, { code: 48, name: "Laisamis" },
  ],
  11: [ // Isiolo
    { code: 49, name: "Isiolo North" }, { code: 50, name: "Isiolo South" },
  ],
  12: [ // Meru
    { code: 51, name: "Igembe South" }, { code: 52, name: "Igembe Central" }, { code: 53, name: "Igembe North" },
    { code: 54, name: "Tigania West" }, { code: 55, name: "Tigania East" }, { code: 56, name: "North Imenti" },
    { code: 57, name: "Buuri" }, { code: 58, name: "Central Imenti" }, { code: 59, name: "South Imenti" },
  ],
  13: [ // Tharaka-Nithi
    { code: 60, name: "Maara" }, { code: 61, name: "Chuka/Igambang'ombe" }, { code: 62, name: "Tharaka" },
  ],
  14: [ // Embu
    { code: 63, name: "Manyatta" }, { code: 64, name: "Runyenjes" }, { code: 65, name: "Mbeere South" }, { code: 66, name: "Mbeere North" },
  ],
  15: [ // Kitui
    { code: 67, name: "Mwingi North" }, { code: 68, name: "Mwingi West" }, { code: 69, name: "Mwingi Central" },
    { code: 70, name: "Kitui West" }, { code: 71, name: "Kitui Rural" }, { code: 72, name: "Kitui Central" },
    { code: 73, name: "Kitui East" }, { code: 74, name: "Kitui South" },
  ],
  16: [ // Machakos
    { code: 75, name: "Masinga" }, { code: 76, name: "Yatta" }, { code: 77, name: "Kangundo" },
    { code: 78, name: "Matungulu" }, { code: 79, name: "Kathiani" }, { code: 80, name: "Mavoko" },
    { code: 81, name: "Machakos Town" }, { code: 82, name: "Mwala" },
  ],
  17: [ // Makueni
    { code: 83, name: "Mbooni" }, { code: 84, name: "Kilome" }, { code: 85, name: "Kaiti" },
    { code: 86, name: "Makueni" }, { code: 87, name: "Kibwezi West" }, { code: 88, name: "Kibwezi East" },
  ],
  18: [ // Nyandarua
    { code: 89, name: "Kinangop" }, { code: 90, name: "Kipipiri" }, { code: 91, name: "Ol Kalou" },
    { code: 92, name: "Ol Jorok" }, { code: 93, name: "Ndaragwa" },
  ],
  19: [ // Nyeri
    { code: 94, name: "Tetu" }, { code: 95, name: "Kieni" }, { code: 96, name: "Mathira" },
    { code: 97, name: "Othaya" }, { code: 98, name: "Mukurweini" }, { code: 99, name: "Nyeri Town" },
  ],
  20: [ // Kirinyaga
    { code: 100, name: "Mwea" }, { code: 101, name: "Gichugu" }, { code: 102, name: "Ndia" }, { code: 103, name: "Kirinyaga Central" },
  ],
  21: [ // Murang'a
    { code: 104, name: "Kandara" }, { code: 105, name: "Gatanga" }, { code: 106, name: "Kiharu" },
    { code: 107, name: "Kigumo" }, { code: 108, name: "Maragwa" }, { code: 109, name: "Kangema" }, { code: 110, name: "Mathioya" },
  ],
  22: [ // Kiambu
    { code: 111, name: "Gatundu South" }, { code: 112, name: "Gatundu North" }, { code: 113, name: "Juja" },
    { code: 114, name: "Thika Town" }, { code: 115, name: "Ruiru" }, { code: 116, name: "Githunguri" },
    { code: 117, name: "Kiambu" }, { code: 118, name: "Kiambaa" }, { code: 119, name: "Kabete" },
    { code: 120, name: "Kikuyu" }, { code: 121, name: "Limuru" }, { code: 122, name: "Lari" },
  ],
  23: [ // Turkana
    { code: 123, name: "Turkana North" }, { code: 124, name: "Turkana West" }, { code: 125, name: "Turkana Central" },
    { code: 126, name: "Loima" }, { code: 127, name: "Turkana South" }, { code: 128, name: "Turkana East" },
  ],
  24: [ // West Pokot
    { code: 129, name: "Kapenguria" }, { code: 130, name: "Sigor" }, { code: 131, name: "Kacheliba" }, { code: 132, name: "Pokot South" },
  ],
  25: [ // Samburu
    { code: 133, name: "Samburu West" }, { code: 134, name: "Samburu North" }, { code: 135, name: "Samburu East" },
  ],
  26: [ // Trans Nzoia
    { code: 136, name: "Kwanza" }, { code: 137, name: "Endebess" }, { code: 138, name: "Saboti" },
    { code: 139, name: "Kiminini" }, { code: 140, name: "Cherangany" },
  ],
  27: [ // Uasin Gishu
    { code: 141, name: "Soy" }, { code: 142, name: "Turbo" }, { code: 143, name: "Moiben" },
    { code: 144, name: "Ainabkoi" }, { code: 145, name: "Kapseret" }, { code: 146, name: "Kesses" },
  ],
  28: [ // Elgeyo Marakwet
    { code: 147, name: "Marakwet East" }, { code: 148, name: "Marakwet West" }, { code: 149, name: "Keiyo North" }, { code: 150, name: "Keiyo South" },
  ],
  29: [ // Nandi
    { code: 151, name: "Tinderet" }, { code: 152, name: "Aldai" }, { code: 153, name: "Nandi Hills" },
    { code: 154, name: "Chesumei" }, { code: 155, name: "Emgwen" }, { code: 156, name: "Mosop" },
  ],
  30: [ // Baringo
    { code: 157, name: "Tiaty" }, { code: 158, name: "Baringo North" }, { code: 159, name: "Baringo Central" },
    { code: 160, name: "Baringo South" }, { code: 161, name: "Mogotio" }, { code: 162, name: "Eldama Ravine" },
  ],
  31: [ // Laikipia
    { code: 163, name: "Laikipia West" }, { code: 164, name: "Laikipia East" }, { code: 165, name: "Laikipia North" },
  ],
  32: [ // Nakuru
    { code: 166, name: "Molo" }, { code: 167, name: "Njoro" }, { code: 168, name: "Naivasha" },
    { code: 169, name: "Gilgil" }, { code: 170, name: "Kuresoi South" }, { code: 171, name: "Kuresoi North" },
    { code: 172, name: "Subukia" }, { code: 173, name: "Rongai" }, { code: 174, name: "Bahati" },
    { code: 175, name: "Nakuru Town West" }, { code: 176, name: "Nakuru Town East" },
  ],
  33: [ // Narok
    { code: 177, name: "Kilgoris" }, { code: 178, name: "Emurua Dikirr" }, { code: 179, name: "Narok North" },
    { code: 180, name: "Narok East" }, { code: 181, name: "Narok South" }, { code: 182, name: "Narok West" },
  ],
  34: [ // Kajiado
    { code: 183, name: "Kajiado North" }, { code: 184, name: "Kajiado Central" }, { code: 185, name: "Kajiado East" },
    { code: 186, name: "Kajiado West" }, { code: 187, name: "Kajiado South" },
  ],
  35: [ // Kericho
    { code: 188, name: "Kipkelion East" }, { code: 189, name: "Kipkelion West" }, { code: 190, name: "Ainamoi" },
    { code: 191, name: "Bureti" }, { code: 192, name: "Belgut" }, { code: 193, name: "Sigowet/Soin" },
  ],
  36: [ // Bomet
    { code: 194, name: "Sotik" }, { code: 195, name: "Chepalungu" }, { code: 196, name: "Bomet East" },
    { code: 197, name: "Bomet Central" }, { code: 198, name: "Konoin" },
  ],
  37: [ // Kakamega
    { code: 199, name: "Lugari" }, { code: 200, name: "Likuyani" }, { code: 201, name: "Malava" },
    { code: 202, name: "Lurambi" }, { code: 203, name: "Navakholo" }, { code: 204, name: "Mumias West" },
    { code: 205, name: "Mumias East" }, { code: 206, name: "Matungu" }, { code: 207, name: "Butere" },
    { code: 208, name: "Khwisero" }, { code: 209, name: "Shinyalu" }, { code: 210, name: "Ikolomani" },
  ],
  38: [ // Vihiga
    { code: 211, name: "Vihiga" }, { code: 212, name: "Sabatia" }, { code: 213, name: "Hamisi" },
    { code: 214, name: "Luanda" }, { code: 215, name: "Emuhaya" },
  ],
  39: [ // Bungoma
    { code: 216, name: "Mt. Elgon" }, { code: 217, name: "Sirisia" }, { code: 218, name: "Kabuchai" },
    { code: 219, name: "Bumula" }, { code: 220, name: "Kanduyi" }, { code: 221, name: "Webuye East" },
    { code: 222, name: "Webuye West" }, { code: 223, name: "Kimilili" }, { code: 224, name: "Tongaren" },
  ],
  40: [ // Busia
    { code: 225, name: "Teso North" }, { code: 226, name: "Teso South" }, { code: 227, name: "Nambale" },
    { code: 228, name: "Matayos" }, { code: 229, name: "Butula" }, { code: 230, name: "Funyula" }, { code: 231, name: "Budalangi" },
  ],
  41: [ // Siaya
    { code: 232, name: "Ugenya" }, { code: 233, name: "Ugunja" }, { code: 234, name: "Alego Usonga" },
    { code: 235, name: "Gem" }, { code: 236, name: "Bondo" }, { code: 237, name: "Rarieda" },
  ],
  42: [ // Kisumu
    { code: 238, name: "Kisumu East" }, { code: 239, name: "Kisumu West" }, { code: 240, name: "Kisumu Central" },
    { code: 241, name: "Seme" }, { code: 242, name: "Nyando" }, { code: 243, name: "Muhoroni" }, { code: 244, name: "Nyakach" },
  ],
  43: [ // Homa Bay
    { code: 245, name: "Kasipul" }, { code: 246, name: "Kabondo Kasipul" }, { code: 247, name: "Karachuonyo" },
    { code: 248, name: "Rangwe" }, { code: 249, name: "Homa Bay Town" }, { code: 250, name: "Ndhiwa" },
    { code: 251, name: "Mbita" }, { code: 252, name: "Suba" },
  ],
  44: [ // Migori
    { code: 253, name: "Rongo" }, { code: 254, name: "Awendo" }, { code: 255, name: "Suna East" },
    { code: 256, name: "Suna West" }, { code: 257, name: "Uriri" }, { code: 258, name: "Nyatike" },
    { code: 259, name: "Kuria West" }, { code: 260, name: "Kuria East" },
  ],
  45: [ // Kisii
    { code: 261, name: "Bonchari" }, { code: 262, name: "South Mugirango" }, { code: 263, name: "Bomachoge Borabu" },
    { code: 264, name: "Bobasi" }, { code: 265, name: "Bomachoge Chache" }, { code: 266, name: "Nyaribari Masaba" },
    { code: 267, name: "Nyaribari Chache" }, { code: 268, name: "Kitutu Chache North" }, { code: 269, name: "Kitutu Chache South" },
  ],
  46: [ // Nyamira
    { code: 270, name: "Kitutu Masaba" }, { code: 271, name: "West Mugirango" }, { code: 272, name: "North Mugirango" },
    { code: 273, name: "Borabu" },
  ],
  47: [ // Nairobi
    { code: 274, name: "Westlands" }, { code: 275, name: "Dagoretti North" }, { code: 276, name: "Dagoretti South" },
    { code: 277, name: "Langata" }, { code: 278, name: "Kibra" }, { code: 279, name: "Roysambu" },
    { code: 280, name: "Kasarani" }, { code: 281, name: "Ruaraka" }, { code: 282, name: "Embakasi South" },
    { code: 283, name: "Embakasi North" }, { code: 284, name: "Embakasi Central" }, { code: 285, name: "Embakasi East" },
    { code: 286, name: "Embakasi West" }, { code: 287, name: "Makadara" }, { code: 288, name: "Kamukunji" },
    { code: 289, name: "Starehe" }, { code: 290, name: "Mathare" },
  ],
};

export async function seedGeography() {
  console.log("Seeding geography...");

  // Seed counties
  const countyIdMap: Record<number, string> = {};
  for (const county of COUNTIES) {
    const [result] = await db
      .insert(countiesTable)
      .values(county)
      .onConflictDoUpdate({
        target: countiesTable.code,
        set: { name: county.name, capital: county.capital, latitude: county.latitude, longitude: county.longitude },
      })
      .returning({ id: countiesTable.id, code: countiesTable.code });
    countyIdMap[result.code] = result.id;
  }
  console.log(`✓ ${COUNTIES.length} counties seeded`);

  // Seed constituencies
  const constIdMap: Record<number, string> = {};
  let constCount = 0;
  for (const [countyCodeStr, consts] of Object.entries(CONSTITUENCY_DATA)) {
    const countyCode = Number(countyCodeStr);
    const countyId = countyIdMap[countyCode];
    if (!countyId) continue;

    for (const c of consts) {
      const [result] = await db
        .insert(constituenciesTable)
        .values({ code: c.code, name: c.name, countyId })
        .onConflictDoUpdate({
          target: constituenciesTable.code,
          set: { name: c.name, countyId },
        })
        .returning({ id: constituenciesTable.id, code: constituenciesTable.code });
      constIdMap[result.code] = result.id;
      constCount++;
    }
  }
  console.log(`✓ ${constCount} constituencies seeded`);

  // Seed all 1,450 real wards from county_data.json
  // County index in _countyData (0-based) matches county code (1-based): _countyData[code-1]
  // Constituency index within county matches CONSTITUENCY_DATA[code] order.
  let wardCount = 0;
  let wardCode = 1;
  for (const [countyCodeStr, consts] of Object.entries(CONSTITUENCY_DATA)) {
    const countyCode = Number(countyCodeStr);
    const countyId = countyIdMap[countyCode];
    if (!countyId) continue;

    const jsonCounty = _countyData[countyCode - 1];

    for (let constIdx = 0; constIdx < consts.length; constIdx++) {
      const c = consts[constIdx];
      const constId = constIdMap[c.code];
      if (!constId) continue;

      const jsonWards = jsonCounty?.constituencies[constIdx]?.wards ?? [];

      if (jsonWards.length === 0) {
        // Fallback: generate 3 generic ward names if JSON data is missing for this constituency
        const fallbackNames = [`${c.name} East`, `${c.name} Central`, `${c.name} West`];
        for (const wardName of fallbackNames) {
          await db
            .insert(wardsTable)
            .values({ code: wardCode++, name: wardName, constituencyId: constId, countyId })
            .onConflictDoUpdate({ target: wardsTable.code, set: { name: wardName } });
          wardCount++;
        }
      } else {
        for (const ward of jsonWards) {
          await db
            .insert(wardsTable)
            .values({ code: wardCode++, name: ward.name, constituencyId: constId, countyId })
            .onConflictDoUpdate({ target: wardsTable.code, set: { name: ward.name } });
          wardCount++;
        }
      }
    }
  }
  console.log(`✓ ${wardCount} wards seeded`);
}
