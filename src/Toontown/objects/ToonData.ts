import { type ReadonlyVec4, vec4 } from "gl-matrix";

export type ToonDnaInner = [
  string, // head style
  string, // torso style
  string, // legs style
  ToonGender, // gender
  number, // arm color
  number, // glove color
  number, // leg color
  number, // head color
  number, // top texture
  number, // top texture color
  number, // sleeve texture
  number, // sleeve texture color
  number, // bottom texture
  number, // bottom texture color
];

export type ToonDnaCompact =
  | ToonDnaInner
  | [
      "r", // random
      ToonGender,
    ];

export type NpcToonCompact = [
  number, // id
  string, // name
  ToonDnaCompact, // dna
  boolean, // protected
  ToonNpcType, // type
];

export enum ToonNpcType {
  Regular = 0,
  Clerk = 1,
  Tailor = 2,
  HQ = 3,
  Blocker = 4,
  Fisherman = 5,
  Petclerk = 6,
  Kartclerk = 7,
  Partyperson = 8,
  Specialquestgiver = 9,
  Flippytoonhall = 10,
  Scientist = 11,
}

export enum ToonSpecies {
  Dog = "d",
  Cat = "c",
  Horse = "h",
  Mouse = "m",
  Rabbit = "r",
  Duck = "f",
  Monkey = "p",
  Bear = "b",
  Pig = "s",
}

export const ALL_SPECIES = Object.values(ToonSpecies);

export const TOON_BODY_SCALES: Record<ToonSpecies, number> = {
  [ToonSpecies.Dog]: 0.85,
  [ToonSpecies.Cat]: 0.73,
  [ToonSpecies.Horse]: 0.85,
  [ToonSpecies.Mouse]: 0.6,
  [ToonSpecies.Rabbit]: 0.74,
  [ToonSpecies.Duck]: 0.66,
  [ToonSpecies.Monkey]: 0.68,
  [ToonSpecies.Bear]: 0.85,
  [ToonSpecies.Pig]: 0.77,
};

export enum ToonGender {
  Male = "m",
  Female = "f",
}

export const ALL_GENDERS = Object.values(ToonGender);

export const NPC_TOONS: Record<number, NpcToonCompact> = {
  999: [-1, "Toon Tailor", ["r", ToonGender.Male], true, ToonNpcType.Tailor],
  1000: [-1, "Toon HQ", ["r", ToonGender.Male], true, ToonNpcType.HQ],
  1001: [
    1506,
    "Clerk Will",
    ["rss", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 0, 11, 0, 11, 0, 0],
    false,
    ToonNpcType.Clerk,
  ],
  1002: [
    1506,
    "Clerk Bill",
    ["mss", "ss", "l", ToonGender.Male, 3, 0, 3, 3, 1, 10, 1, 10, 0, 18],
    false,
    ToonNpcType.Clerk,
  ],
  1003: [
    1507,
    "HQ Officer",
    ["mls", "ss", "l", ToonGender.Male, 17, 0, 17, 17, 1, 11, 1, 11, 0, 15],
    false,
    ToonNpcType.HQ,
  ],
  1004: [
    1507,
    "HQ Officer",
    ["hsl", "md", "l", ToonGender.Female, 10, 0, 10, 10, 1, 24, 1, 24, 24, 27],
    false,
    ToonNpcType.HQ,
  ],
  1005: [
    1507,
    "HQ Officer",
    ["hss", "ms", "l", ToonGender.Male, 3, 0, 3, 3, 1, 11, 1, 11, 0, 9],
    false,
    ToonNpcType.HQ,
  ],
  1006: [
    1507,
    "HQ Officer",
    ["cll", "ss", "l", ToonGender.Female, 18, 0, 18, 18, 1, 25, 1, 25, 19, 27],
    false,
    ToonNpcType.HQ,
  ],
  1007: [
    1508,
    "Longjohn Leroy",
    ["csl", "ls", "m", ToonGender.Male, 9, 0, 9, 9, 1, 12, 1, 12, 0, 20],
    false,
    ToonNpcType.Tailor,
  ],
  1008: [
    1000,
    "Fisherman Furball",
    ["cls", "ms", "m", ToonGender.Male, 3, 0, 3, 3, 0, 27, 0, 27, 0, 17],
    false,
    ToonNpcType.Fisherman,
  ],
  1009: [
    1510,
    "Clerk Barky",
    ["dsl", "ss", "m", ToonGender.Male, 17, 0, 17, 17, 0, 0, 0, 0, 0, 14],
    false,
    ToonNpcType.Petclerk,
  ],
  1010: [
    1510,
    "Clerk Purr",
    ["dss", "ld", "m", ToonGender.Female, 10, 0, 10, 10, 0, 0, 0, 0, 26, 27],
    false,
    ToonNpcType.Petclerk,
  ],
  1011: [
    1510,
    "Clerk Bloop",
    ["fll", "sd", "m", ToonGender.Female, 1, 0, 1, 1, 0, 1, 0, 1, 4, 25],
    false,
    ToonNpcType.Petclerk,
  ],
  1012: [
    1000,
    "Party Planner Pickles",
    ["fls", "ms", "l", ToonGender.Male, 14, 0, 3, 3, 0, 1, 0, 1, 0, 13],
    true,
    ToonNpcType.Partyperson,
  ],
  1013: [
    1000,
    "Party Planner Patty",
    ["fss", "ms", "m", ToonGender.Female, 2, 0, 3, 3, 1, 6, 1, 6, 5, 6],
    true,
    ToonNpcType.Partyperson,
  ],
  1101: [
    1627,
    "Billy Budd",
    ["fll", "ls", "m", ToonGender.Male, 14, 0, 14, 14, 1, 3, 1, 3, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  1102: [
    1612,
    "Captain Carl",
    ["fsl", "ms", "m", ToonGender.Male, 7, 0, 7, 7, 1, 3, 1, 3, 1, 2],
    false,
    ToonNpcType.Regular,
  ],
  1103: [
    1626,
    "Fishy Frank",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  1104: [
    1617,
    "Doctor Squall",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  1105: [
    1606,
    "Admiral Hook",
    ["rss", "ms", "m", ToonGender.Male, 6, 0, 6, 6, 0, 4, 0, 4, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  1106: [
    1604,
    "Mrs. Starch",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  1107: [
    1621,
    "Cal Estenicks",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  1108: [
    1629,
    "HQ Officer",
    ["hsl", "ls", "l", ToonGender.Male, 6, 0, 6, 6, 0, 6, 0, 6, 1, 1],
    false,
    ToonNpcType.HQ,
  ],
  1109: [
    1629,
    "HQ Officer",
    ["hss", "ls", "l", ToonGender.Female, 22, 0, 22, 22, 0, 8, 0, 8, 14, 27],
    false,
    ToonNpcType.HQ,
  ],
  1110: [
    1629,
    "HQ Officer",
    ["cll", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 1, 6, 1, 6, 1, 16],
    false,
    ToonNpcType.HQ,
  ],
  1111: [
    1629,
    "HQ Officer",
    ["csl", "ld", "l", ToonGender.Female, 6, 0, 6, 6, 1, 9, 1, 9, 2, 2],
    false,
    ToonNpcType.HQ,
  ],
  1112: [
    1602,
    "Gary Glubglub",
    ["cls", "ms", "l", ToonGender.Male, 20, 0, 20, 20, 1, 7, 1, 7, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  1113: [
    1608,
    "Lisa Luff",
    ["dll", "ms", "l", ToonGender.Female, 13, 0, 13, 13, 1, 11, 1, 11, 0, 27],
    false,
    ToonNpcType.Regular,
  ],
  1114: [
    1609,
    "Charlie Chum",
    ["dss", "ls", "l", ToonGender.Male, 5, 0, 5, 5, 1, 7, 1, 7, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  1115: [
    1613,
    "Sheila Squid, Atty",
    ["fll", "sd", "l", ToonGender.Female, 21, 0, 21, 21, 1, 12, 1, 12, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  1116: [
    1614,
    "Barnacle Bessie",
    ["fsl", "ls", "l", ToonGender.Female, 13, 0, 13, 13, 1, 12, 1, 12, 1, 25],
    false,
    ToonNpcType.Regular,
  ],
  1117: [
    1615,
    "Captain Yucks",
    ["fls", "ss", "l", ToonGender.Male, 5, 0, 5, 5, 0, 9, 0, 9, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  1118: [
    1616,
    "Choppy McDougal",
    ["rll", "ls", "l", ToonGender.Male, 19, 0, 19, 19, 0, 9, 0, 9, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  1121: [
    1619,
    "Linda Landlubber",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  1122: [
    1620,
    "Salty Stan",
    ["hll", "ms", "l", ToonGender.Male, 12, 0, 12, 12, 0, 11, 0, 11, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  1123: [
    1622,
    "Electra Eel",
    ["hss", "ms", "l", ToonGender.Female, 4, 0, 4, 4, 1, 23, 1, 23, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  1124: [
    1624,
    "Flappy Docksplinter",
    ["cll", "ls", "l", ToonGender.Male, 19, 0, 19, 19, 1, 11, 1, 11, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  1125: [
    1628,
    "Eileen Overboard",
    ["csl", "sd", "l", ToonGender.Female, 12, 0, 12, 12, 1, 24, 1, 24, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  1126: [
    1129,
    "Fisherman Barney",
    ["cls", "ms", "l", ToonGender.Male, 4, 0, 4, 4, 1, 11, 1, 11, 0, 19],
    false,
    ToonNpcType.Fisherman,
  ],
  1201: [
    1710,
    "Barnacle Barbara",
    ["css", "ls", "s", ToonGender.Female, 12, 0, 12, 12, 0, 0, 0, 0, 1, 24],
    false,
    ToonNpcType.Regular,
  ],
  1202: [
    1713,
    "Art",
    ["cls", "ss", "s", ToonGender.Male, 4, 0, 4, 4, 0, 0, 0, 0, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  1203: [1725, "Ahab", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  1204: [
    1712,
    "Rocky Shores",
    ["dss", "ms", "s", ToonGender.Male, 12, 0, 12, 12, 1, 1, 1, 1, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  1205: [
    1729,
    "HQ Officer",
    ["fll", "ss", "s", ToonGender.Male, 4, 0, 4, 4, 1, 1, 1, 1, 1, 1],
    false,
    ToonNpcType.HQ,
  ],
  1206: [
    1729,
    "HQ Officer",
    ["fss", "ld", "s", ToonGender.Female, 19, 0, 19, 19, 1, 2, 1, 2, 7, 11],
    false,
    ToonNpcType.HQ,
  ],
  1207: [
    1729,
    "HQ Officer",
    ["fls", "ms", "s", ToonGender.Male, 12, 0, 12, 12, 1, 2, 1, 2, 1, 16],
    false,
    ToonNpcType.HQ,
  ],
  1208: [
    1729,
    "HQ Officer",
    ["rsl", "ls", "m", ToonGender.Female, 3, 0, 3, 3, 1, 3, 1, 3, 23, 27],
    false,
    ToonNpcType.HQ,
  ],
  1209: [
    1701,
    "Professor Plank",
    ["rss", "ss", "m", ToonGender.Female, 19, 0, 19, 19, 0, 4, 0, 4, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  1210: [1703, "Gang Wei", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  1211: [
    1705,
    "Wynn Bag",
    ["mls", "ms", "m", ToonGender.Male, 4, 0, 4, 4, 0, 4, 0, 4, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  1212: [
    1706,
    "Toby Tonguestinger",
    ["hsl", "ss", "m", ToonGender.Male, 18, 0, 18, 18, 0, 4, 0, 4, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  1213: [
    1707,
    "Dante Dolphin",
    ["hss", "ls", "m", ToonGender.Male, 10, 0, 10, 10, 0, 4, 0, 4, 1, 15],
    false,
    ToonNpcType.Regular,
  ],
  1214: [
    1709,
    "Gusty Kate",
    ["cll", "sd", "m", ToonGender.Female, 2, 0, 2, 2, 0, 7, 0, 7, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  1215: [
    1711,
    "Dinah Down",
    ["css", "ms", "m", ToonGender.Female, 18, 0, 18, 18, 0, 7, 0, 7, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  1216: [
    1714,
    "Rod Reel",
    ["cls", "ls", "m", ToonGender.Male, 10, 0, 10, 10, 1, 5, 1, 5, 1, 2],
    false,
    ToonNpcType.Regular,
  ],
  1217: [1716, "CC Weed", ["r", ToonGender.Female], false, ToonNpcType.Regular],
  1218: [
    1717,
    "Pacific Tim",
    ["dss", "ms", "m", ToonGender.Male, 17, 0, 17, 17, 1, 6, 1, 6, 1, 17],
    false,
    ToonNpcType.Regular,
  ],
  1219: [
    1718,
    "Brian Beachead",
    ["fll", "ss", "m", ToonGender.Male, 9, 0, 9, 9, 1, 6, 1, 6, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  1220: [
    1719,
    "Carla Canal",
    ["fsl", "md", "m", ToonGender.Female, 2, 0, 2, 2, 1, 9, 1, 9, 7, 23],
    false,
    ToonNpcType.Regular,
  ],
  1221: [
    1720,
    "Blisters McKee",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  1222: [1721, "Shep Ahoy", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  1223: [
    1723,
    "Sid Squid",
    ["rss", "ls", "l", ToonGender.Male, 2, 0, 2, 2, 0, 8, 0, 8, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  1224: [
    1724,
    "Emily Eel",
    ["mss", "sd", "l", ToonGender.Female, 17, 0, 17, 17, 0, 21, 0, 21, 7, 9],
    false,
    ToonNpcType.Regular,
  ],
  1225: [
    1726,
    "Bonzo Bilgepump",
    ["mls", "ss", "l", ToonGender.Male, 9, 0, 9, 9, 0, 9, 0, 9, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  1226: [
    1727,
    "Heave Ho",
    ["hsl", "ls", "l", ToonGender.Male, 2, 0, 2, 2, 0, 9, 0, 9, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  1227: [
    1728,
    "Coral Reef",
    ["hss", "sd", "l", ToonGender.Female, 17, 0, 17, 17, 0, 22, 0, 22, 3, 7],
    false,
    ToonNpcType.Regular,
  ],
  1228: [
    1236,
    "Fisherman Reed",
    ["cll", "ms", "l", ToonGender.Male, 8, 0, 8, 8, 1, 9, 1, 9, 1, 0],
    false,
    ToonNpcType.Fisherman,
  ],
  1301: [
    1828,
    "Alice",
    ["mls", "md", "m", ToonGender.Female, 16, 0, 16, 16, 1, 8, 1, 8, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  1302: [
    1832,
    "Melville",
    ["hsl", "ms", "m", ToonGender.Male, 8, 0, 8, 8, 1, 6, 1, 6, 0, 18],
    false,
    ToonNpcType.Regular,
  ],
  1303: [
    1826,
    "Claggart",
    ["hls", "ss", "m", ToonGender.Male, 22, 0, 22, 22, 1, 6, 1, 6, 0, 15],
    false,
    ToonNpcType.Regular,
  ],
  1304: [
    1804,
    "Svetlana",
    ["cll", "md", "m", ToonGender.Female, 15, 0, 15, 15, 1, 9, 1, 9, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  1305: [
    1835,
    "HQ Officer",
    ["css", "ms", "m", ToonGender.Male, 7, 0, 7, 7, 1, 7, 1, 7, 0, 9],
    false,
    ToonNpcType.HQ,
  ],
  1306: [
    1835,
    "HQ Officer",
    ["cls", "ms", "m", ToonGender.Female, 24, 0, 24, 24, 0, 12, 0, 12, 0, 7],
    false,
    ToonNpcType.HQ,
  ],
  1307: [
    1835,
    "HQ Officer",
    ["dsl", "ls", "m", ToonGender.Male, 15, 0, 15, 15, 0, 8, 0, 8, 0, 20],
    false,
    ToonNpcType.HQ,
  ],
  1308: [
    1835,
    "HQ Officer",
    ["dss", "sd", "m", ToonGender.Female, 8, 0, 8, 8, 0, 21, 0, 21, 4, 5],
    false,
    ToonNpcType.HQ,
  ],
  1309: [
    1802,
    "Seafoam",
    ["fll", "ms", "l", ToonGender.Female, 23, 0, 23, 23, 0, 21, 0, 21, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  1310: [
    1805,
    "Ted Tackle",
    ["fsl", "ss", "l", ToonGender.Male, 15, 0, 15, 15, 0, 9, 0, 9, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  1311: [
    1806,
    "Topsy Turvey",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  1312: [
    1807,
    "Ethan Keel",
    ["rsl", "ms", "l", ToonGender.Male, 21, 0, 21, 21, 1, 9, 1, 9, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  1313: [
    1808,
    "William Wake",
    ["rss", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 1, 10, 1, 10, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  1314: [
    1809,
    "Rusty Ralph",
    ["mss", "ls", "l", ToonGender.Male, 6, 0, 6, 6, 1, 10, 1, 10, 0, 16],
    false,
    ToonNpcType.Regular,
  ],
  1315: [
    1810,
    "Doctor Drift",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  1316: [
    1811,
    "Wilma Wobble",
    ["hsl", "ms", "l", ToonGender.Female, 14, 0, 14, 14, 1, 24, 1, 24, 7, 7],
    false,
    ToonNpcType.Regular,
  ],
  1317: [
    1813,
    "Paula Pylon",
    ["hss", "ld", "l", ToonGender.Female, 7, 0, 7, 7, 1, 25, 1, 25, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  1318: [
    1814,
    "Dinghy Dan",
    ["cll", "ms", "l", ToonGender.Male, 20, 0, 20, 20, 0, 12, 0, 12, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  1319: [
    1815,
    "Davey Drydock",
    ["csl", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 0, 27, 0, 27, 0, 18],
    false,
    ToonNpcType.Regular,
  ],
  1320: [1818, "Ted Calm", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  1321: [
    1819,
    "Dinah Docker",
    ["dsl", "md", "l", ToonGender.Female, 22, 0, 22, 22, 0, 27, 0, 27, 7, 5],
    false,
    ToonNpcType.Regular,
  ],
  1322: [
    1820,
    "Whoopie Cushion",
    ["dss", "ls", "m", ToonGender.Female, 13, 0, 13, 13, 0, 0, 0, 0, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  1323: [
    1821,
    "Stinky Ned",
    ["fll", "ss", "m", ToonGender.Male, 6, 0, 6, 6, 0, 0, 0, 0, 1, 2],
    false,
    ToonNpcType.Regular,
  ],
  1324: [
    1823,
    "Pearl Diver",
    ["fsl", "md", "m", ToonGender.Female, 22, 0, 22, 22, 0, 1, 0, 1, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  1325: [
    1824,
    "Ned Setter",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  1326: [
    1825,
    "Felicia Chips",
    ["rll", "ms", "m", ToonGender.Female, 6, 0, 6, 6, 1, 2, 1, 2, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  1327: [
    1829,
    "Cindy Splat",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  1328: [
    1830,
    "Fred Flounder",
    ["rls", "ms", "m", ToonGender.Male, 13, 0, 13, 13, 1, 2, 1, 2, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  1329: [
    1831,
    "Shelly Seaweed",
    ["mls", "ms", "m", ToonGender.Female, 4, 0, 4, 4, 1, 3, 1, 3, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  1330: [
    1833,
    "Porter Hole",
    ["hsl", "ls", "m", ToonGender.Male, 19, 0, 19, 19, 1, 3, 1, 3, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  1331: [
    1834,
    "Rudy Rudder",
    ["hss", "ls", "m", ToonGender.Male, 12, 0, 12, 12, 0, 3, 0, 3, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  1332: [
    1330,
    "Fisherman Shane",
    ["cll", "ms", "m", ToonGender.Male, 5, 0, 5, 5, 0, 4, 0, 4, 1, 13],
    false,
    ToonNpcType.Fisherman,
  ],
  2002: [
    2514,
    "Banker Bob",
    ["hss", "ls", "l", ToonGender.Male, 4, 0, 4, 4, 0, 3, 0, 3, 1, 18],
    true,
    ToonNpcType.Regular,
  ],
  2003: [
    2516,
    "Professor Pete",
    ["cll", "ms", "l", ToonGender.Male, 18, 0, 18, 18, 0, 4, 0, 4, 1, 15],
    true,
    ToonNpcType.Regular,
  ],
  2004: [
    2521,
    "Tammy the Tailor",
    ["rll", "md", "m", ToonGender.Female, 15, 0, 5, 7, 3, 5, 3, 5, 0, 3],
    true,
    ToonNpcType.Tailor,
  ],
  2005: [
    2518,
    "Librarian Larry",
    ["cls", "ls", "l", ToonGender.Male, 4, 0, 4, 4, 0, 4, 0, 4, 1, 9],
    true,
    ToonNpcType.Regular,
  ],
  2006: [
    2519,
    "Clerk Clark",
    ["dsl", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 1, 4, 1, 4, 1, 2],
    true,
    ToonNpcType.Clerk,
  ],
  2007: [
    2520,
    "HQ Officer",
    ["dss", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 1, 5, 1, 5, 1, 20],
    true,
    ToonNpcType.HQ,
  ],
  2008: [
    2520,
    "HQ Officer",
    ["fll", "ss", "l", ToonGender.Male, 3, 0, 3, 3, 1, 5, 1, 5, 1, 17],
    true,
    ToonNpcType.HQ,
  ],
  2009: [
    2520,
    "HQ Officer",
    ["fsl", "md", "l", ToonGender.Female, 18, 0, 18, 18, 1, 8, 1, 8, 11, 27],
    true,
    ToonNpcType.HQ,
  ],
  2010: [
    2520,
    "HQ Officer",
    ["fls", "ls", "l", ToonGender.Female, 11, 0, 11, 11, 1, 8, 1, 8, 8, 4],
    true,
    ToonNpcType.HQ,
  ],
  2011: [
    2519,
    "Clerk Clara",
    ["rll", "ms", "l", ToonGender.Female, 2, 0, 2, 2, 1, 9, 1, 9, 23, 27],
    true,
    ToonNpcType.Clerk,
  ],
  2012: [
    2000,
    "Fisherman Freddy",
    ["rss", "ls", "l", ToonGender.Male, 17, 0, 17, 17, 1, 6, 1, 6, 1, 1],
    true,
    ToonNpcType.Fisherman,
  ],
  2013: [
    2522,
    "Clerk Poppy",
    ["rls", "ms", "l", ToonGender.Male, 9, 0, 9, 9, 0, 7, 0, 7, 1, 19],
    true,
    ToonNpcType.Petclerk,
  ],
  2014: [
    2522,
    "Clerk Peppy",
    ["mls", "ms", "m", ToonGender.Female, 2, 0, 2, 2, 0, 12, 0, 12, 1, 0],
    true,
    ToonNpcType.Petclerk,
  ],
  2015: [
    2522,
    "Clerk Pappy",
    ["hsl", "ls", "m", ToonGender.Male, 17, 0, 17, 17, 0, 8, 0, 8, 1, 13],
    true,
    ToonNpcType.Petclerk,
  ],
  2016: [
    2000,
    "Party Planner Pumpkin",
    ["sls", "ls", "m", ToonGender.Male, 10, 0, 9, 9, 0, 3, 0, 3, 0, 18],
    true,
    ToonNpcType.Partyperson,
  ],
  2017: [
    2000,
    "Party Planner Polly",
    ["sss", "ld", "m", ToonGender.Female, 10, 0, 9, 9, 0, 23, 0, 23, 0, 5],
    true,
    ToonNpcType.Partyperson,
  ],
  2018: [
    2513,
    "Doctor Dimm",
    ["fll", "ss", "s", ToonGender.Male, 15, 0, 15, 15, 99, 27, 86, 27, 39, 27],
    true,
    ToonNpcType.Scientist,
  ],
  2019: [
    2513,
    "Doctor Surlee",
    ["pls", "ls", "l", ToonGender.Male, 9, 0, 9, 9, 98, 27, 86, 27, 38, 27],
    true,
    ToonNpcType.Scientist,
  ],
  2020: [
    2513,
    "Professor Prepostera",
    ["hss", "ms", "m", ToonGender.Male, 20, 0, 20, 20, 97, 27, 86, 27, 37, 27],
    true,
    ToonNpcType.Scientist,
  ],
  2101: [
    2601,
    "Dentist Daniel",
    ["rll", "ms", "l", ToonGender.Male, 15, 0, 15, 15, 0, 9, 0, 9, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  2102: [
    2619,
    "Sheriff Sherry",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2103: [
    2616,
    "Sneezy Kitty",
    ["csl", "ss", "s", ToonGender.Male, 9, 0, 8, 5, 0, 11, 0, 11, 2, 10],
    false,
    ToonNpcType.Regular,
  ],
  2104: [
    2671,
    "HQ Officer",
    ["mls", "ms", "m", ToonGender.Male, 15, 0, 15, 15, 1, 10, 1, 10, 0, 16],
    true,
    ToonNpcType.HQ,
  ],
  2105: [
    2671,
    "HQ Officer",
    ["hsl", "ss", "m", ToonGender.Male, 7, 0, 7, 7, 1, 10, 1, 10, 0, 13],
    true,
    ToonNpcType.HQ,
  ],
  2106: [
    2671,
    "HQ Officer",
    ["hss", "ld", "m", ToonGender.Female, 23, 0, 23, 23, 1, 23, 1, 23, 24, 27],
    true,
    ToonNpcType.HQ,
  ],
  2107: [
    2671,
    "HQ Officer",
    ["cll", "sd", "m", ToonGender.Female, 14, 0, 14, 14, 1, 24, 1, 24, 7, 4],
    true,
    ToonNpcType.HQ,
  ],
  2108: [
    2603,
    "Canary Coalmine",
    ["csl", "ms", "m", ToonGender.Female, 7, 0, 7, 7, 1, 24, 1, 24, 3, 2],
    false,
    ToonNpcType.Regular,
  ],
  2109: [
    2604,
    "Babbles Blowhard",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  2110: [
    2605,
    "Bill Board",
    ["dll", "ls", "m", ToonGender.Male, 14, 0, 14, 14, 0, 27, 0, 27, 0, 15],
    false,
    ToonNpcType.Regular,
  ],
  2111: [
    2607,
    "Dancing Diego",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  2112: [
    2610,
    "Dr. Tom",
    ["fll", "ss", "m", ToonGender.Male, 20, 0, 20, 20, 0, 27, 0, 27, 0, 9],
    true,
    ToonNpcType.Regular,
  ],
  2113: [
    2617,
    "Rollo The Amazing",
    ["fsl", "ls", "m", ToonGender.Male, 14, 0, 14, 14, 0, 0, 0, 0, 0, 2],
    false,
    ToonNpcType.Regular,
  ],
  2114: [
    2618,
    "Roz Berry",
    ["fls", "sd", "m", ToonGender.Female, 6, 0, 6, 6, 0, 0, 0, 0, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  2115: [
    2621,
    "Patty Papercut",
    ["rll", "ms", "l", ToonGender.Female, 22, 0, 22, 22, 1, 1, 1, 1, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  2116: [
    2624,
    "Bruiser McDougal",
    ["rss", "ls", "l", ToonGender.Male, 13, 0, 13, 13, 1, 1, 1, 1, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  2117: [
    2625,
    "Ma Putrid",
    ["rls", "sd", "l", ToonGender.Female, 6, 0, 6, 6, 1, 2, 1, 2, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  2118: [
    2626,
    "Jesse Jester",
    ["mls", "ss", "l", ToonGender.Male, 20, 0, 20, 20, 1, 1, 1, 1, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  2119: [
    2629,
    "Honey Haha",
    ["hll", "ss", "l", ToonGender.Female, 13, 0, 13, 13, 1, 3, 1, 3, 19, 27],
    true,
    ToonNpcType.Regular,
  ],
  2120: [
    2632,
    "Professor Binky",
    ["hss", "ls", "l", ToonGender.Male, 5, 0, 5, 5, 1, 2, 1, 2, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  2121: [
    2633,
    "Madam Chuckle",
    ["cll", "ls", "l", ToonGender.Female, 21, 0, 21, 21, 0, 4, 0, 4, 4, 4],
    false,
    ToonNpcType.Regular,
  ],
  2122: [
    2639,
    "Harry Ape",
    ["csl", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 0, 3, 0, 3, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  2123: [
    2643,
    "Spamonia Biggles",
    ["cls", "md", "l", ToonGender.Female, 4, 0, 4, 4, 0, 5, 0, 5, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  2124: [
    2644,
    "T.P. Rolle",
    ["dll", "sd", "l", ToonGender.Female, 21, 0, 21, 21, 0, 5, 0, 5, 8, 21],
    false,
    ToonNpcType.Regular,
  ],
  2125: [
    2649,
    "Lazy Hal",
    ["dss", "ss", "l", ToonGender.Male, 12, 0, 12, 12, 0, 4, 0, 4, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  2126: [
    2654,
    "Professor Guffaw",
    ["dls", "ld", "l", ToonGender.Female, 4, 0, 4, 4, 0, 6, 0, 6, 3, 7],
    true,
    ToonNpcType.Regular,
  ],
  2127: [
    2655,
    "Woody Nickel",
    ["fsl", "ms", "l", ToonGender.Male, 19, 0, 19, 19, 0, 5, 0, 5, 1, 15],
    true,
    ToonNpcType.Regular,
  ],
  2128: [
    2656,
    "Loony Louis",
    ["fss", "ss", "l", ToonGender.Male, 12, 0, 12, 12, 1, 5, 1, 5, 1, 12],
    true,
    ToonNpcType.Regular,
  ],
  2129: [
    2657,
    "Frank Furter",
    ["rll", "ss", "l", ToonGender.Male, 4, 0, 4, 4, 1, 5, 1, 5, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  2130: [
    2659,
    "Joy Buzzer",
    ["rss", "md", "l", ToonGender.Female, 19, 0, 19, 19, 1, 8, 1, 8, 7, 7],
    false,
    ToonNpcType.Regular,
  ],
  2131: [
    2660,
    "Feather Duster",
    ["rls", "ls", "l", ToonGender.Female, 12, 0, 12, 12, 1, 8, 1, 8, 1, 26],
    true,
    ToonNpcType.Regular,
  ],
  2132: [
    2661,
    "Daffy Don",
    ["mls", "ss", "l", ToonGender.Male, 4, 0, 4, 4, 1, 6, 1, 6, 1, 17],
    false,
    ToonNpcType.Regular,
  ],
  2133: [
    2662,
    "Dr. Euphoric",
    ["hll", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 1, 6, 1, 6, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  2134: [
    2664,
    "Silent Simone",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2135: [
    2665,
    "Mary",
    ["hls", "ms", "l", ToonGender.Female, 3, 0, 3, 3, 0, 12, 0, 12, 2, 26],
    true,
    ToonNpcType.Regular,
  ],
  2136: [
    2666,
    "Sal Snicker",
    ["csl", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 0, 8, 0, 8, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  2137: [
    2667,
    "Happy Heikyung",
    ["css", "sd", "l", ToonGender.Female, 11, 0, 11, 11, 0, 21, 0, 21, 24, 27],
    false,
    ToonNpcType.Regular,
  ],
  2138: [
    2669,
    "Muldoon",
    ["dll", "ss", "l", ToonGender.Male, 3, 0, 3, 3, 0, 9, 0, 9, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  2139: [
    2670,
    "Dan Dribbles",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  2140: [
    2156,
    "Fisherman Billy",
    ["dls", "ls", "l", ToonGender.Male, 10, 0, 10, 10, 1, 9, 1, 9, 1, 10],
    false,
    ToonNpcType.Fisherman,
  ],
  2201: [
    2711,
    "Postmaster Pete",
    ["dss", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 1, 6, 1, 6, 0, 17],
    true,
    ToonNpcType.Regular,
  ],
  2202: [
    2718,
    "Shirley U. Jest",
    ["r", ToonGender.Female],
    true,
    ToonNpcType.Regular,
  ],
  2203: [
    2742,
    "HQ Officer",
    ["fss", "ms", "s", ToonGender.Male, 19, 0, 19, 19, 0, 7, 0, 7, 0, 11],
    true,
    ToonNpcType.HQ,
  ],
  2204: [
    2742,
    "HQ Officer",
    ["fls", "ss", "s", ToonGender.Male, 13, 0, 13, 13, 0, 7, 0, 7, 0, 6],
    true,
    ToonNpcType.HQ,
  ],
  2205: [
    2742,
    "HQ Officer",
    ["rsl", "md", "s", ToonGender.Female, 4, 0, 4, 4, 0, 11, 0, 11, 16, 27],
    true,
    ToonNpcType.HQ,
  ],
  2206: [
    2742,
    "HQ Officer",
    ["rss", "sd", "s", ToonGender.Female, 21, 0, 21, 21, 0, 12, 0, 12, 0, 8],
    true,
    ToonNpcType.HQ,
  ],
  2207: [
    2705,
    "Will Wiseacre",
    ["mss", "ss", "s", ToonGender.Male, 12, 0, 12, 12, 0, 8, 0, 8, 0, 16],
    true,
    ToonNpcType.Regular,
  ],
  2208: [
    2708,
    "Sticky Lou",
    ["mls", "ls", "s", ToonGender.Male, 4, 0, 4, 4, 1, 8, 1, 8, 0, 13],
    true,
    ToonNpcType.Regular,
  ],
  2209: [
    2712,
    "Charlie Chortle",
    ["hsl", "ms", "s", ToonGender.Male, 19, 0, 19, 19, 1, 8, 1, 8, 0, 10],
    true,
    ToonNpcType.Regular,
  ],
  2210: [
    2713,
    "Tee Hee",
    ["hss", "ms", "s", ToonGender.Female, 12, 0, 12, 12, 1, 21, 1, 21, 1, 24],
    true,
    ToonNpcType.Regular,
  ],
  2211: [
    2716,
    "Sally Spittake",
    ["cll", "ss", "s", ToonGender.Female, 3, 0, 3, 3, 1, 22, 1, 22, 25, 27],
    true,
    ToonNpcType.Regular,
  ],
  2212: [
    2717,
    "Weird Warren",
    ["css", "ls", "s", ToonGender.Male, 18, 0, 18, 18, 1, 9, 1, 9, 0, 18],
    false,
    ToonNpcType.Regular,
  ],
  2213: [
    2720,
    "Lucy Tires",
    ["cls", "ls", "s", ToonGender.Female, 12, 0, 12, 12, 1, 23, 1, 23, 11, 27],
    true,
    ToonNpcType.Regular,
  ],
  2214: [2723, "Sam Stain", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  2215: [
    2727,
    "Sid Seltzer",
    ["dss", "ls", "m", ToonGender.Male, 18, 0, 18, 18, 0, 11, 0, 11, 0, 9],
    false,
    ToonNpcType.Regular,
  ],
  2216: [
    2728,
    "Nona Seeya",
    ["fll", "sd", "m", ToonGender.Female, 11, 0, 11, 11, 0, 25, 0, 25, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  2217: [
    2729,
    "Sharky Jones",
    ["fsl", "ss", "m", ToonGender.Male, 4, 0, 4, 4, 0, 12, 0, 12, 0, 20],
    true,
    ToonNpcType.Regular,
  ],
  2218: [
    2730,
    "Fanny Pages",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2219: [
    2732,
    "Chef Knucklehead",
    ["rll", "ms", "m", ToonGender.Male, 10, 0, 10, 10, 0, 27, 0, 27, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  2220: [
    2733,
    "Rick Rockhead",
    ["rss", "ss", "m", ToonGender.Male, 3, 0, 3, 3, 1, 12, 1, 12, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  2221: [
    2734,
    "Clovinia Cling",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2222: [
    2735,
    "Shorty Fuse",
    ["mls", "ls", "m", ToonGender.Male, 10, 0, 10, 10, 1, 0, 1, 0, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  2223: [
    2739,
    "Sasha Sidesplitter",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2224: [
    2740,
    "Smokey Joe",
    ["hss", "ss", "m", ToonGender.Male, 17, 0, 17, 17, 1, 1, 1, 1, 0, 16],
    false,
    ToonNpcType.Regular,
  ],
  2225: [
    2236,
    "Fisherman Droopy",
    ["cll", "ls", "m", ToonGender.Male, 9, 0, 9, 9, 1, 1, 1, 1, 0, 13],
    false,
    ToonNpcType.Fisherman,
  ],
  2301: [
    2804,
    "Dr. Pulyurleg",
    ["cll", "ms", "m", ToonGender.Male, 10, 0, 10, 10, 1, 3, 1, 3, 0, 6],
    true,
    ToonNpcType.Regular,
  ],
  2302: [
    2831,
    "Professor Wiggle",
    ["css", "ms", "m", ToonGender.Male, 3, 0, 3, 3, 1, 3, 1, 3, 0, 1],
    true,
    ToonNpcType.Regular,
  ],
  2303: [
    2834,
    "Nurse Nancy",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2304: [
    2832,
    "HQ Officer",
    ["dss", "ss", "m", ToonGender.Male, 9, 0, 9, 9, 0, 10, 0, 10, 1, 12],
    true,
    ToonNpcType.HQ,
  ],
  2305: [
    2832,
    "HQ Officer",
    ["dss", "ss", "m", ToonGender.Male, 8, 0, 8, 8, 1, 0, 1, 0, 1, 9],
    true,
    ToonNpcType.HQ,
  ],
  2306: [
    2832,
    "HQ Officer",
    ["fll", "md", "m", ToonGender.Female, 24, 0, 24, 24, 1, 0, 1, 0, 16, 27],
    true,
    ToonNpcType.HQ,
  ],
  2307: [
    2832,
    "HQ Officer",
    ["fsl", "ls", "m", ToonGender.Female, 16, 0, 16, 16, 1, 1, 1, 1, 3, 1],
    true,
    ToonNpcType.HQ,
  ],
  2308: [
    2801,
    "Nancy Gas",
    ["fls", "ss", "m", ToonGender.Female, 8, 0, 8, 8, 1, 1, 1, 1, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  2309: [
    2802,
    "Big Bruce",
    ["rsl", "ls", "m", ToonGender.Male, 22, 0, 22, 22, 1, 1, 1, 1, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  2311: [
    2809,
    "Franz Neckvein",
    ["mss", "ss", "m", ToonGender.Male, 7, 0, 7, 7, 0, 2, 0, 2, 1, 6],
    true,
    ToonNpcType.Regular,
  ],
  2312: [
    2837,
    "Dr. Sensitive",
    ["mls", "ld", "m", ToonGender.Female, 24, 0, 24, 24, 0, 3, 0, 3, 4, 6],
    false,
    ToonNpcType.Regular,
  ],
  2313: [
    2817,
    "Lucy Shirtspot",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  2314: [
    2818,
    "Ned Slinger",
    ["hss", "ms", "m", ToonGender.Male, 7, 0, 7, 7, 0, 3, 0, 3, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  2315: [
    2822,
    "Chewy Morsel",
    ["cll", "ss", "m", ToonGender.Male, 21, 0, 21, 21, 0, 3, 0, 3, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  2316: [
    2823,
    "Cindy Sprinkles",
    ["csl", "md", "l", ToonGender.Female, 15, 0, 15, 15, 0, 5, 0, 5, 0, 23],
    false,
    ToonNpcType.Regular,
  ],
  2318: [
    2829,
    "Tony Maroni",
    ["dsl", "ss", "l", ToonGender.Male, 21, 0, 21, 21, 1, 4, 1, 4, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  2319: [
    2830,
    "Zippy",
    ["dss", "ls", "l", ToonGender.Male, 14, 0, 14, 14, 1, 5, 1, 5, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  2320: [
    2839,
    "Crunchy Alfredo",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  2321: [
    2341,
    "Fisherman Punchy",
    ["fsl", "ss", "l", ToonGender.Male, 21, 0, 21, 21, 1, 5, 1, 5, 0, 12],
    false,
    ToonNpcType.Fisherman,
  ],
  3001: [
    3506,
    "Betty Freezes",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3002: [
    3508,
    "HQ Officer",
    ["cls", "ms", "m", ToonGender.Male, 4, 0, 4, 4, 1, 9, 1, 9, 0, 18],
    false,
    ToonNpcType.HQ,
  ],
  3003: [
    3508,
    "HQ Officer",
    ["dsl", "ss", "m", ToonGender.Female, 19, 0, 19, 19, 1, 22, 1, 22, 25, 27],
    false,
    ToonNpcType.HQ,
  ],
  3004: [
    3508,
    "HQ Officer",
    ["dss", "ls", "m", ToonGender.Male, 12, 0, 12, 12, 1, 10, 1, 10, 0, 12],
    false,
    ToonNpcType.HQ,
  ],
  3005: [
    3508,
    "HQ Officer",
    ["fll", "ms", "m", ToonGender.Male, 4, 0, 4, 4, 0, 11, 0, 11, 0, 9],
    false,
    ToonNpcType.HQ,
  ],
  3006: [
    3507,
    "Clerk Lenny",
    ["fsl", "ss", "m", ToonGender.Male, 18, 0, 18, 18, 0, 11, 0, 11, 0, 2],
    false,
    ToonNpcType.Clerk,
  ],
  3007: [
    3507,
    "Clerk Penny",
    ["fls", "ld", "m", ToonGender.Female, 12, 0, 12, 12, 0, 25, 0, 25, 8, 5],
    false,
    ToonNpcType.Clerk,
  ],
  3008: [
    3509,
    "Warren Bundles",
    ["rll", "ms", "l", ToonGender.Male, 4, 0, 4, 4, 0, 12, 0, 12, 0, 17],
    false,
    ToonNpcType.Tailor,
  ],
  3009: [
    3000,
    "Fisherman Frizzy",
    ["rss", "ls", "l", ToonGender.Female, 19, 0, 19, 19, 0, 26, 0, 26, 4, 23],
    false,
    ToonNpcType.Fisherman,
  ],
  3010: [
    3511,
    "Clerk Skip",
    ["rls", "ss", "l", ToonGender.Male, 10, 0, 10, 10, 0, 12, 0, 12, 0, 11],
    false,
    ToonNpcType.Petclerk,
  ],
  3011: [
    3511,
    "Clerk Dip",
    ["mls", "md", "l", ToonGender.Female, 3, 0, 3, 3, 1, 26, 1, 26, 26, 27],
    false,
    ToonNpcType.Petclerk,
  ],
  3012: [
    3511,
    "Clerk Kipp",
    ["hsl", "ms", "l", ToonGender.Male, 18, 0, 18, 18, 1, 12, 1, 12, 0, 1],
    false,
    ToonNpcType.Petclerk,
  ],
  3013: [
    3000,
    "Party Planner Pete",
    ["cls", "ss", "m", ToonGender.Male, 18, 0, 17, 17, 1, 7, 1, 7, 1, 9],
    true,
    ToonNpcType.Partyperson,
  ],
  3014: [
    3000,
    "Party Planner Penny",
    ["css", "sd", "m", ToonGender.Female, 17, 0, 16, 16, 0, 24, 0, 24, 0, 9],
    true,
    ToonNpcType.Partyperson,
  ],
  3101: [
    3611,
    "Mr. Cow",
    ["mls", "ls", "l", ToonGender.Male, 16, 0, 16, 16, 1, 1, 1, 1, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  3102: [
    3625,
    "Auntie Freeze",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3103: [3641, "Fred", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  3104: [
    3602,
    "Bonnie",
    ["cll", "ss", "l", ToonGender.Female, 16, 0, 16, 16, 0, 4, 0, 4, 3, 2],
    false,
    ToonNpcType.Regular,
  ],
  3105: [
    3651,
    "Frosty Freddy",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  3106: [
    3636,
    "Gus Gooseburger",
    ["fll", "ls", "l", ToonGender.Male, 8, 2, 8, 8, 10, 27, 0, 27, 7, 11],
    false,
    ToonNpcType.Regular,
  ],
  3107: [
    3630,
    "Patty Passport",
    ["dll", "ms", "l", ToonGender.Female, 15, 0, 15, 15, 0, 5, 0, 5, 4, 4],
    false,
    ToonNpcType.Regular,
  ],
  3108: [
    3638,
    "Toboggan Ted",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  3109: [
    3637,
    "Kate",
    ["fll", "sd", "m", ToonGender.Female, 23, 0, 23, 23, 1, 6, 1, 6, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  3110: [
    3629,
    "Chicken Boy",
    ["fss", "ms", "l", ToonGender.Male, 10, 10, 10, 10, 16, 4, 0, 4, 5, 4],
    false,
    ToonNpcType.Regular,
  ],
  3111: [
    3627,
    "Snooty Sinjin",
    ["dsl", "ls", "s", ToonGender.Male, 6, 0, 6, 6, 14, 27, 10, 27, 1, 14],
    true,
    ToonNpcType.Regular,
  ],
  3112: [
    3607,
    "Lil Oldman",
    ["rll", "ls", "m", ToonGender.Male, 21, 0, 21, 21, 1, 5, 1, 5, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  3113: [
    3618,
    "Hysterical Harry",
    ["rss", "ms", "m", ToonGender.Male, 14, 0, 14, 14, 1, 5, 1, 5, 0, 2],
    false,
    ToonNpcType.Regular,
  ],
  3114: [
    3620,
    "Henry the Hazard",
    ["rls", "ss", "m", ToonGender.Male, 7, 0, 7, 7, 0, 6, 0, 6, 0, 20],
    false,
    ToonNpcType.Regular,
  ],
  3115: [
    3654,
    "HQ Officer",
    ["mls", "ls", "m", ToonGender.Male, 21, 0, 21, 21, 0, 7, 0, 7, 0, 17],
    false,
    ToonNpcType.HQ,
  ],
  3116: [
    3654,
    "HQ Officer",
    ["hll", "ls", "m", ToonGender.Female, 14, 0, 14, 14, 0, 11, 0, 11, 0, 12],
    false,
    ToonNpcType.HQ,
  ],
  3117: [
    3654,
    "HQ Officer",
    ["hss", "ss", "m", ToonGender.Male, 6, 0, 6, 6, 0, 7, 0, 7, 0, 11],
    false,
    ToonNpcType.HQ,
  ],
  3118: [
    3654,
    "HQ Officer",
    ["cll", "ls", "m", ToonGender.Male, 20, 0, 20, 20, 0, 8, 0, 8, 0, 6],
    false,
    ToonNpcType.HQ,
  ],
  3119: [
    3653,
    "Creepy Carl",
    ["csl", "ms", "m", ToonGender.Male, 14, 0, 14, 14, 0, 8, 0, 8, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  3120: [
    3610,
    "Mike Mittens",
    ["cls", "ss", "m", ToonGender.Male, 6, 0, 6, 6, 1, 8, 1, 8, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  3121: [
    3601,
    "Joe Shockit",
    ["dll", "ls", "m", ToonGender.Male, 20, 0, 20, 20, 1, 8, 1, 8, 0, 16],
    false,
    ToonNpcType.Regular,
  ],
  3122: [
    3608,
    "Lucy Luge",
    ["dss", "md", "l", ToonGender.Female, 13, 0, 13, 13, 1, 21, 1, 21, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  3123: [
    3612,
    "Frank Lloyd Ice",
    ["dls", "ms", "l", ToonGender.Male, 6, 0, 6, 6, 1, 9, 1, 9, 0, 10],
    false,
    ToonNpcType.Regular,
  ],
  3124: [
    3613,
    "Lance Iceberg",
    ["fsl", "ss", "l", ToonGender.Male, 20, 0, 20, 20, 1, 9, 1, 9, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  3125: [
    3614,
    "Colonel Crunchmouth",
    ["fls", "ls", "l", ToonGender.Male, 13, 0, 13, 13, 1, 9, 1, 9, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  3126: [
    3615,
    "Colestra Awl",
    ["rll", "ls", "l", ToonGender.Female, 6, 0, 6, 6, 0, 24, 0, 24, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  3127: [
    3617,
    "Ifalla Yufalla",
    ["rss", "ms", "l", ToonGender.Female, 21, 0, 21, 21, 0, 24, 0, 24, 19, 27],
    false,
    ToonNpcType.Regular,
  ],
  3128: [
    3621,
    "Sticky George",
    ["rls", "ls", "l", ToonGender.Male, 13, 0, 13, 13, 0, 11, 0, 11, 0, 12],
    false,
    ToonNpcType.Regular,
  ],
  3129: [
    3623,
    "Baker Bridget",
    ["mls", "sd", "l", ToonGender.Female, 4, 0, 4, 4, 0, 25, 0, 25, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  3130: [
    3624,
    "Sandy",
    ["hll", "ms", "l", ToonGender.Female, 21, 0, 21, 21, 0, 26, 0, 26, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  3131: [
    3634,
    "Lazy Lorenzo",
    ["hss", "ls", "l", ToonGender.Male, 12, 0, 12, 12, 0, 12, 0, 12, 0, 20],
    false,
    ToonNpcType.Regular,
  ],
  3132: [3635, "Ashy", ["r", ToonGender.Female], false, ToonNpcType.Regular],
  3133: [
    3642,
    "Dr. Friezeframe",
    ["csl", "ms", "l", ToonGender.Male, 19, 0, 19, 19, 1, 12, 1, 12, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  3134: [
    3643,
    "Lounge Lassard",
    ["cls", "ss", "l", ToonGender.Male, 12, 0, 12, 12, 1, 0, 1, 0, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  3135: [
    3644,
    "Soggy Nell",
    ["dll", "md", "l", ToonGender.Female, 4, 0, 4, 4, 1, 0, 1, 0, 4, 12],
    false,
    ToonNpcType.Regular,
  ],
  3136: [
    3647,
    "Happy Sue",
    ["dss", "ls", "l", ToonGender.Female, 19, 0, 19, 19, 1, 1, 1, 1, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  3137: [
    3648,
    "Mr. Freeze",
    ["dls", "ss", "l", ToonGender.Male, 12, 0, 12, 12, 1, 1, 1, 1, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  3138: [
    3649,
    "Chef Bumblesoup",
    ["fsl", "ld", "l", ToonGender.Female, 3, 0, 3, 3, 1, 2, 1, 2, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  3139: [
    3650,
    "Granny Icestockings",
    ["fss", "sd", "l", ToonGender.Female, 19, 0, 19, 19, 0, 2, 0, 2, 16, 27],
    false,
    ToonNpcType.Regular,
  ],
  3140: [
    3136,
    "Fisherman Lucille",
    ["rll", "ms", "l", ToonGender.Female, 11, 0, 11, 11, 0, 3, 0, 3, 12, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  3201: [
    3715,
    "Aunt Arctic",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3202: [
    3723,
    "Shakey",
    ["rsl", "ss", "l", ToonGender.Male, 6, 0, 6, 6, 1, 12, 1, 12, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  3203: [
    3712,
    "Walt",
    ["rss", "ls", "l", ToonGender.Male, 20, 0, 20, 20, 1, 12, 1, 12, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  3204: [
    3734,
    "Dr. Ivanna Cee",
    ["mss", "md", "l", ToonGender.Female, 13, 0, 13, 13, 1, 26, 1, 26, 4, 5],
    false,
    ToonNpcType.Regular,
  ],
  3205: [
    3721,
    "Bumpy Noggin",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  3206: [
    3722,
    "Vidalia VaVoom",
    ["hsl", "ss", "l", ToonGender.Female, 21, 0, 21, 21, 1, 0, 1, 0, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  3207: [
    3713,
    "Dr. Mumbleface",
    ["hss", "ls", "l", ToonGender.Male, 13, 0, 13, 13, 0, 0, 0, 0, 1, 15],
    false,
    ToonNpcType.Regular,
  ],
  3208: [
    3732,
    "Grumpy Phil",
    ["cll", "ms", "l", ToonGender.Male, 5, 0, 5, 5, 0, 1, 0, 1, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  3209: [
    3737,
    "Giggles McGhee",
    ["css", "ss", "l", ToonGender.Male, 19, 0, 19, 19, 0, 1, 0, 1, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  3210: [
    3728,
    "Simian Sam",
    ["pls", "ls", "s", ToonGender.Male, 13, 0, 13, 13, 2, 1, 2, 1, 5, 2],
    false,
    ToonNpcType.Regular,
  ],
  3211: [
    3710,
    "Fanny Freezes",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3212: [
    3707,
    "Frosty Fred",
    ["dss", "ss", "s", ToonGender.Male, 19, 0, 19, 19, 0, 2, 0, 2, 1, 17],
    false,
    ToonNpcType.Regular,
  ],
  3213: [
    3739,
    "HQ Officer",
    ["fll", "ls", "s", ToonGender.Male, 12, 0, 12, 12, 1, 2, 1, 2, 1, 14],
    false,
    ToonNpcType.HQ,
  ],
  3214: [
    3739,
    "HQ Officer",
    ["fsl", "md", "s", ToonGender.Female, 4, 0, 4, 4, 1, 4, 1, 4, 3, 1],
    false,
    ToonNpcType.HQ,
  ],
  3215: [
    3739,
    "HQ Officer",
    ["fls", "ms", "s", ToonGender.Male, 19, 0, 19, 19, 1, 3, 1, 3, 1, 6],
    false,
    ToonNpcType.HQ,
  ],
  3216: [
    3739,
    "HQ Officer",
    ["rll", "ss", "s", ToonGender.Male, 12, 0, 12, 12, 1, 4, 1, 4, 1, 1],
    false,
    ToonNpcType.HQ,
  ],
  3217: [
    3738,
    "Sweaty Pete",
    ["rss", "ls", "s", ToonGender.Male, 4, 0, 4, 4, 1, 4, 1, 4, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  3218: [
    3702,
    "Blue Lou",
    ["mss", "ms", "s", ToonGender.Male, 18, 0, 18, 18, 1, 4, 1, 4, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  3219: [
    3705,
    "Tom Tandemfrost",
    ["mls", "ss", "s", ToonGender.Male, 12, 0, 12, 12, 0, 5, 0, 5, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  3220: [
    3706,
    "Mr. Sneeze",
    ["hsl", "ls", "s", ToonGender.Male, 4, 0, 4, 4, 0, 5, 0, 5, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  3221: [
    3708,
    "Nelly Snow",
    ["hss", "sd", "s", ToonGender.Female, 19, 0, 19, 19, 0, 8, 0, 8, 7, 12],
    false,
    ToonNpcType.Regular,
  ],
  3222: [
    3716,
    "Mindy Windburn",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3223: [
    3718,
    "Chappy",
    ["csl", "ls", "m", ToonGender.Male, 4, 0, 4, 4, 0, 6, 0, 6, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  3224: [
    3719,
    "Freida Frostbite",
    ["cls", "md", "m", ToonGender.Female, 18, 0, 18, 18, 0, 9, 0, 9, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  3225: [3724, "Blake Ice", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  3226: [
    3725,
    "Santa Paws",
    ["dss", "ss", "m", ToonGender.Male, 3, 0, 3, 3, 1, 7, 1, 7, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  3227: [
    3726,
    "Solar Ray",
    ["fll", "ls", "m", ToonGender.Male, 17, 0, 17, 17, 1, 7, 1, 7, 1, 2],
    false,
    ToonNpcType.Regular,
  ],
  3228: [
    3730,
    "Wynne Chill",
    ["fsl", "ls", "m", ToonGender.Female, 11, 0, 11, 11, 1, 12, 1, 12, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  3229: [
    3731,
    "Hernia Belt",
    ["fls", "ms", "m", ToonGender.Female, 2, 0, 2, 2, 1, 12, 1, 12, 0, 7],
    false,
    ToonNpcType.Regular,
  ],
  3230: [
    3735,
    "Balding Benjy",
    ["rll", "ls", "m", ToonGender.Male, 17, 0, 17, 17, 1, 8, 1, 8, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  3231: [
    3736,
    "Choppy",
    ["rss", "ms", "m", ToonGender.Male, 9, 0, 9, 9, 0, 9, 0, 9, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  3232: [
    3236,
    "Fisherman Albert",
    ["rls", "ss", "m", ToonGender.Male, 3, 0, 3, 3, 0, 10, 0, 10, 1, 9],
    false,
    ToonNpcType.Fisherman,
  ],
  3301: [
    3810,
    "Paisley Patches",
    ["dsl", "ms", "m", ToonGender.Female, 11, 0, 11, 11, 0, 22, 0, 22, 2, 11],
    false,
    ToonNpcType.Regular,
  ],
  3302: [
    3806,
    "Bjorn Bord",
    ["dls", "ls", "m", ToonGender.Male, 4, 0, 4, 4, 0, 10, 0, 10, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  3303: [
    3830,
    "Dr. Peepers",
    ["fll", "ms", "m", ToonGender.Male, 18, 0, 18, 18, 0, 10, 0, 10, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  3304: [
    3828,
    "Eddie the Yeti",
    ["pll", "ls", "l", ToonGender.Female, 0, 0, 0, 0, 1, 5, 1, 5, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  3305: [
    3812,
    "Mack Ramay",
    ["fls", "ls", "m", ToonGender.Male, 3, 0, 3, 3, 0, 11, 0, 11, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  3306: [
    3821,
    "Paula Behr",
    ["bss", "sd", "m", ToonGender.Female, 0, 0, 0, 0, 31, 27, 22, 27, 8, 11],
    false,
    ToonNpcType.Regular,
  ],
  3307: [
    3329,
    "Fisherman Fredrica",
    ["rss", "ls", "m", ToonGender.Female, 11, 0, 11, 11, 1, 24, 1, 24, 1, 9],
    false,
    ToonNpcType.Fisherman,
  ],
  3308: [
    3815,
    "Donald Frump",
    ["mss", "ss", "m", ToonGender.Male, 3, 0, 3, 3, 1, 11, 1, 11, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  3309: [
    3826,
    "Bootsy",
    ["hll", "ls", "m", ToonGender.Male, 17, 0, 17, 17, 1, 11, 1, 11, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  3310: [
    3823,
    "Professor Flake",
    ["pll", "ms", "m", ToonGender.Male, 10, 0, 10, 10, 60, 27, 49, 27, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  3311: [
    3829,
    "Connie Ferris",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  3312: [
    3813,
    "March Harry",
    ["rss", "ms", "l", ToonGender.Male, 4, 0, 4, 4, 5, 2, 5, 2, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  3313: [
    3801,
    "HQ Officer",
    ["css", "ms", "l", ToonGender.Male, 9, 0, 9, 9, 0, 0, 0, 0, 1, 2],
    false,
    ToonNpcType.HQ,
  ],
  3314: [
    3801,
    "HQ Officer",
    ["cls", "ms", "l", ToonGender.Female, 1, 0, 1, 1, 0, 0, 0, 0, 3, 25],
    false,
    ToonNpcType.HQ,
  ],
  3315: [
    3801,
    "HQ Officer",
    ["dsl", "ls", "l", ToonGender.Male, 17, 0, 17, 17, 0, 0, 0, 0, 1, 17],
    false,
    ToonNpcType.HQ,
  ],
  3316: [
    3801,
    "HQ Officer",
    ["dss", "md", "l", ToonGender.Female, 10, 0, 10, 10, 0, 1, 0, 1, 10, 27],
    false,
    ToonNpcType.HQ,
  ],
  3317: [
    3816,
    "Kissy Krissy",
    ["fll", "ls", "l", ToonGender.Female, 1, 0, 1, 1, 0, 2, 0, 2, 3, 24],
    false,
    ToonNpcType.Regular,
  ],
  3318: [
    3808,
    "Johnny Cashmere",
    ["dss", "ms", "m", ToonGender.Male, 18, 0, 18, 18, 57, 1, 46, 1, 12, 1],
    false,
    ToonNpcType.Regular,
  ],
  3319: [
    3825,
    "Sam Stetson",
    ["fls", "ls", "l", ToonGender.Male, 9, 0, 9, 9, 1, 2, 1, 2, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  3320: [
    3814,
    "Fizzy Lizzy",
    ["rsl", "ls", "l", ToonGender.Female, 1, 0, 1, 1, 1, 3, 1, 3, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  3321: [
    3818,
    "Pickaxe Paul",
    ["rss", "ss", "l", ToonGender.Male, 16, 0, 16, 16, 1, 2, 1, 2, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  3322: [3819, "Flue Lou", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  3323: [
    3811,
    "Dallas Borealis",
    ["mls", "ms", "l", ToonGender.Male, 22, 0, 22, 22, 1, 3, 1, 3, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  3324: [
    3809,
    "Snaggletooth Stu",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  3325: [
    3827,
    "Groovy Garland",
    ["hss", "ls", "l", ToonGender.Male, 8, 0, 8, 8, 0, 4, 0, 4, 1, 0],
    false,
    ToonNpcType.Regular,
  ],
  3326: [
    3820,
    "Blanche",
    ["cll", "md", "l", ToonGender.Female, 24, 0, 24, 24, 0, 6, 0, 6, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  3327: [
    3824,
    "Chuck Roast",
    ["css", "ms", "l", ToonGender.Male, 15, 0, 15, 15, 0, 5, 0, 5, 1, 15],
    false,
    ToonNpcType.Regular,
  ],
  3328: [
    3807,
    "Shady Sadie",
    ["dll", "sd", "l", ToonGender.Female, 8, 0, 8, 8, 0, 25, 0, 25, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  3329: [
    3817,
    "Treading Ed",
    ["dll", "ms", "l", ToonGender.Male, 6, 0, 6, 6, 0, 1, 0, 1, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  4001: [
    4502,
    "Molly Molloy",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  4002: [
    4504,
    "HQ Officer",
    ["fll", "ss", "m", ToonGender.Male, 5, 0, 5, 5, 0, 2, 0, 2, 1, 17],
    false,
    ToonNpcType.HQ,
  ],
  4003: [
    4504,
    "HQ Officer",
    ["fsl", "md", "m", ToonGender.Female, 21, 0, 21, 21, 0, 3, 0, 3, 10, 27],
    false,
    ToonNpcType.HQ,
  ],
  4004: [
    4504,
    "HQ Officer",
    ["fls", "ls", "m", ToonGender.Female, 13, 0, 13, 13, 1, 3, 1, 3, 2, 11],
    false,
    ToonNpcType.HQ,
  ],
  4005: [
    4504,
    "HQ Officer",
    ["rll", "ss", "m", ToonGender.Female, 4, 0, 4, 4, 1, 4, 1, 4, 24, 27],
    false,
    ToonNpcType.HQ,
  ],
  4006: [
    4503,
    "Clerk Doe",
    ["rss", "md", "m", ToonGender.Female, 21, 0, 21, 21, 1, 4, 1, 4, 8, 8],
    false,
    ToonNpcType.Clerk,
  ],
  4007: [
    4503,
    "Clerk Ray",
    ["rls", "ms", "m", ToonGender.Male, 12, 0, 12, 12, 1, 3, 1, 3, 1, 19],
    false,
    ToonNpcType.Clerk,
  ],
  4008: [
    4506,
    "Tailor Harmony",
    ["mls", "ms", "m", ToonGender.Female, 4, 0, 4, 4, 1, 5, 1, 5, 7, 9],
    false,
    ToonNpcType.Tailor,
  ],
  4009: [
    4000,
    "Fisherman Fanny",
    ["hsl", "ld", "m", ToonGender.Female, 19, 0, 19, 19, 1, 6, 1, 6, 12, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  4010: [
    4508,
    "Clerk Chris",
    ["hss", "ms", "m", ToonGender.Male, 12, 0, 12, 12, 0, 5, 0, 5, 1, 10],
    false,
    ToonNpcType.Petclerk,
  ],
  4011: [
    4508,
    "Clerk Neil",
    ["cll", "ss", "m", ToonGender.Male, 4, 0, 4, 4, 0, 5, 0, 5, 1, 4],
    false,
    ToonNpcType.Petclerk,
  ],
  4012: [
    4508,
    "Clerk Westin Girl",
    ["csl", "ss", "m", ToonGender.Female, 19, 0, 19, 19, 0, 8, 0, 8, 10, 27],
    false,
    ToonNpcType.Petclerk,
  ],
  4013: [
    4000,
    "Party Planner Preston",
    ["bll", "ls", "s", ToonGender.Male, 3, 0, 19, 19, 0, 8, 0, 8, 1, 12],
    true,
    ToonNpcType.Partyperson,
  ],
  4014: [
    4000,
    "Party Planner Penelope",
    ["bss", "md", "m", ToonGender.Female, 24, 0, 19, 19, 0, 24, 0, 24, 0, 12],
    true,
    ToonNpcType.Partyperson,
  ],
  4101: [
    4603,
    "Tom",
    ["cll", "ms", "m", ToonGender.Male, 16, 0, 16, 16, 1, 7, 1, 7, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  4102: [
    4605,
    "Fifi",
    ["csl", "ms", "m", ToonGender.Female, 9, 0, 9, 9, 1, 11, 1, 11, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  4103: [
    4612,
    "Dr. Fret",
    ["cls", "ls", "l", ToonGender.Male, 2, 0, 2, 2, 1, 8, 1, 8, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  4104: [
    4659,
    "HQ Officer",
    ["dll", "ms", "l", ToonGender.Male, 16, 0, 16, 16, 1, 8, 1, 8, 0, 16],
    false,
    ToonNpcType.HQ,
  ],
  4105: [
    4659,
    "HQ Officer",
    ["dss", "ls", "l", ToonGender.Female, 9, 0, 9, 9, 1, 21, 1, 21, 11, 27],
    false,
    ToonNpcType.HQ,
  ],
  4106: [
    4659,
    "HQ Officer",
    ["fll", "ss", "l", ToonGender.Female, 24, 0, 24, 24, 0, 22, 0, 22, 19, 27],
    false,
    ToonNpcType.HQ,
  ],
  4107: [
    4659,
    "HQ Officer",
    ["fsl", "md", "l", ToonGender.Female, 16, 0, 16, 16, 0, 22, 0, 22, 17, 27],
    false,
    ToonNpcType.HQ,
  ],
  4108: [
    4626,
    "Cleff",
    ["fls", "ms", "l", ToonGender.Male, 8, 0, 8, 8, 0, 10, 0, 10, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  4109: [
    4606,
    "Carlos",
    ["rll", "ss", "l", ToonGender.Male, 22, 0, 22, 22, 0, 11, 0, 11, 0, 18],
    false,
    ToonNpcType.Regular,
  ],
  4110: [
    4604,
    "Metra Gnome",
    ["rss", "ld", "l", ToonGender.Female, 16, 0, 16, 16, 0, 24, 0, 24, 3, 2],
    false,
    ToonNpcType.Regular,
  ],
  4111: [4607, "Tom Hum", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  4112: [
    4609,
    "Fa",
    ["mls", "ms", "l", ToonGender.Female, 24, 0, 24, 24, 0, 25, 0, 25, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  4113: [
    4610,
    "Madam Manners",
    ["hsl", "ld", "l", ToonGender.Female, 15, 0, 15, 15, 1, 25, 1, 25, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  4114: [
    4611,
    "Offkey Eric",
    ["hss", "ms", "l", ToonGender.Male, 7, 0, 7, 7, 1, 11, 1, 11, 1, 20],
    false,
    ToonNpcType.Regular,
  ],
  4115: [
    4614,
    "Barbara Seville",
    ["cll", "ls", "l", ToonGender.Female, 23, 0, 23, 23, 1, 26, 1, 26, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  4116: [
    4615,
    "Piccolo",
    ["csl", "ss", "m", ToonGender.Male, 15, 0, 15, 15, 1, 12, 1, 12, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  4117: [
    4617,
    "Mandy Lynn",
    ["cls", "md", "m", ToonGender.Female, 7, 0, 7, 7, 1, 0, 1, 0, 1, 25],
    false,
    ToonNpcType.Regular,
  ],
  4118: [
    4618,
    "Attendant Abe",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4119: [
    4619,
    "Moe Zart",
    ["dss", "ss", "m", ToonGender.Male, 14, 0, 14, 14, 0, 0, 0, 0, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  4120: [
    4622,
    "Viola Padding",
    ["dls", "ld", "m", ToonGender.Female, 7, 0, 7, 7, 0, 1, 0, 1, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4121: [
    4623,
    "Gee Minor",
    ["fsl", "ms", "m", ToonGender.Male, 21, 0, 21, 21, 0, 1, 0, 1, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  4122: [
    4625,
    "Minty Bass",
    ["fls", "ms", "m", ToonGender.Female, 14, 0, 14, 14, 0, 2, 0, 2, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  4123: [
    4628,
    "Lightning Ted",
    ["rll", "ls", "m", ToonGender.Male, 6, 0, 6, 6, 0, 2, 0, 2, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  4124: [
    4629,
    "Riff Raff",
    ["rss", "ms", "m", ToonGender.Male, 20, 0, 20, 20, 0, 2, 0, 2, 1, 4],
    false,
    ToonNpcType.Regular,
  ],
  4125: [
    4630,
    "Melody Wavers",
    ["rls", "ls", "m", ToonGender.Female, 14, 0, 14, 14, 1, 3, 1, 3, 8, 6],
    false,
    ToonNpcType.Regular,
  ],
  4126: [
    4631,
    "Mel Canto",
    ["mls", "ss", "m", ToonGender.Male, 6, 0, 6, 6, 1, 3, 1, 3, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  4127: [
    4632,
    "Happy Feet",
    ["hll", "md", "m", ToonGender.Female, 22, 0, 22, 22, 1, 4, 1, 4, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  4128: [
    4635,
    "Luciano Scoop",
    ["hss", "ms", "m", ToonGender.Male, 13, 0, 13, 13, 1, 3, 1, 3, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  4129: [
    4637,
    "Tootie Twostep",
    ["hls", "ss", "l", ToonGender.Female, 6, 0, 6, 6, 1, 5, 1, 5, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4130: [
    4638,
    "Metal Mike",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4131: [
    4639,
    "Abraham Armoire",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4132: [
    4641,
    "Lowdown Sally",
    ["dll", "ms", "l", ToonGender.Female, 6, 0, 6, 6, 0, 7, 0, 7, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  4133: [
    4642,
    "Scott Poplin",
    ["dss", "ls", "l", ToonGender.Male, 20, 0, 20, 20, 0, 5, 0, 5, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  4134: [
    4645,
    "Disco Dave",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4135: [
    4648,
    "Sluggo Songbird",
    ["fsl", "ms", "l", ToonGender.Male, 5, 0, 5, 5, 0, 6, 0, 6, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  4136: [
    4652,
    "Patty Pause",
    ["fss", "ss", "l", ToonGender.Female, 21, 0, 21, 21, 0, 9, 0, 9, 7, 4],
    false,
    ToonNpcType.Regular,
  ],
  4137: [
    4654,
    "Tony Deff",
    ["rll", "ls", "l", ToonGender.Male, 13, 0, 13, 13, 1, 6, 1, 6, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  4138: [
    4655,
    "Cliff Cleff",
    ["rsl", "ms", "l", ToonGender.Male, 5, 0, 5, 5, 1, 7, 1, 7, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  4139: [
    4657,
    "Harmony Swell",
    ["rls", "ss", "l", ToonGender.Female, 21, 0, 21, 21, 1, 11, 1, 11, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  4140: [
    4658,
    "Clumsy Ned",
    ["mls", "ls", "l", ToonGender.Male, 12, 0, 12, 12, 1, 7, 1, 7, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  4141: [
    4148,
    "Fisherman Jed",
    ["hll", "ms", "l", ToonGender.Male, 4, 0, 4, 4, 1, 8, 1, 8, 1, 4],
    false,
    ToonNpcType.Fisherman,
  ],
  4201: [
    4704,
    "Tina",
    ["mss", "ss", "l", ToonGender.Female, 14, 0, 14, 14, 0, 6, 0, 6, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  4202: [
    4725,
    "Barry",
    ["mls", "ls", "l", ToonGender.Male, 6, 0, 6, 6, 0, 5, 0, 5, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  4203: [
    4702,
    "Lumber Jack",
    ["hsl", "ms", "l", ToonGender.Male, 21, 0, 21, 21, 0, 5, 0, 5, 0, 10],
    false,
    ToonNpcType.Regular,
  ],
  4204: [
    4739,
    "HQ Officer",
    ["hss", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 0, 6, 0, 6, 0, 4],
    false,
    ToonNpcType.HQ,
  ],
  4205: [
    4739,
    "HQ Officer",
    ["cll", "ld", "l", ToonGender.Female, 6, 0, 6, 6, 1, 8, 1, 8, 10, 27],
    false,
    ToonNpcType.HQ,
  ],
  4206: [
    4739,
    "HQ Officer",
    ["css", "sd", "l", ToonGender.Female, 22, 0, 22, 22, 1, 8, 1, 8, 25, 27],
    false,
    ToonNpcType.HQ,
  ],
  4207: [
    4739,
    "HQ Officer",
    ["cls", "ls", "l", ToonGender.Female, 14, 0, 14, 14, 1, 9, 1, 9, 17, 27],
    false,
    ToonNpcType.HQ,
  ],
  4208: [
    4730,
    "Hedy",
    ["dsl", "ss", "l", ToonGender.Female, 6, 0, 6, 6, 1, 9, 1, 9, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  4209: [
    4701,
    "Corny Canter",
    ["dss", "md", "l", ToonGender.Female, 22, 0, 22, 22, 1, 11, 1, 11, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  4211: [
    4703,
    "Carl Concerto",
    ["fsl", "ss", "l", ToonGender.Male, 5, 0, 5, 5, 1, 8, 1, 8, 0, 20],
    false,
    ToonNpcType.Regular,
  ],
  4212: [
    4705,
    "Detective Dirge",
    ["fls", "ls", "l", ToonGender.Male, 20, 0, 20, 20, 0, 9, 0, 9, 0, 17],
    false,
    ToonNpcType.Regular,
  ],
  4213: [
    4707,
    "Fran Foley",
    ["rll", "sd", "l", ToonGender.Female, 13, 0, 13, 13, 0, 21, 0, 21, 24, 27],
    false,
    ToonNpcType.Regular,
  ],
  4214: [
    4709,
    "Tina Toehooks",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  4215: [
    4710,
    "Tim Tailgater",
    ["mss", "ls", "l", ToonGender.Male, 19, 0, 19, 19, 0, 10, 0, 10, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  4216: [
    4712,
    "Gummy Whistle",
    ["mls", "ms", "s", ToonGender.Male, 13, 0, 13, 13, 0, 10, 0, 10, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  4217: [
    4713,
    "Handsome Anton",
    ["hsl", "ms", "s", ToonGender.Male, 5, 0, 5, 5, 0, 10, 0, 10, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  4218: [
    4716,
    "Wilma Wind",
    ["hss", "ss", "s", ToonGender.Female, 21, 0, 21, 21, 1, 23, 1, 23, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4219: [
    4717,
    "Sid Sonata",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4220: [
    4718,
    "Curtis Finger",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4221: [
    4719,
    "Moe Madrigal",
    ["cls", "ss", "s", ToonGender.Male, 19, 0, 19, 19, 1, 11, 1, 11, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  4222: [
    4720,
    "John Doe",
    ["dsl", "ls", "s", ToonGender.Male, 12, 0, 12, 12, 1, 11, 1, 11, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  4223: [
    4722,
    "Penny Prompter",
    ["dss", "sd", "s", ToonGender.Female, 3, 0, 3, 3, 1, 25, 1, 25, 24, 27],
    false,
    ToonNpcType.Regular,
  ],
  4224: [
    4723,
    "Jungle Jim",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4225: [
    4724,
    "Holly Hiss",
    ["fsl", "ld", "s", ToonGender.Female, 12, 0, 12, 12, 0, 27, 0, 27, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  4226: [
    4727,
    "Thelma Throatreacher",
    ["fls", "sd", "s", ToonGender.Female, 3, 0, 3, 3, 0, 0, 0, 0, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  4227: [
    4728,
    "Quiet Francesca",
    ["rll", "ls", "s", ToonGender.Female, 19, 0, 19, 19, 0, 0, 0, 0, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  4228: [
    4729,
    "August Winds",
    ["rss", "ss", "s", ToonGender.Female, 11, 0, 11, 11, 0, 1, 0, 1, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  4229: [
    4731,
    "June Loon",
    ["rls", "md", "m", ToonGender.Female, 3, 0, 3, 3, 0, 1, 0, 1, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4230: [
    4732,
    "Julius Wheezer",
    ["mls", "ms", "m", ToonGender.Male, 18, 0, 18, 18, 1, 1, 1, 1, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  4231: [
    4735,
    "Steffi Squeezebox",
    ["hsl", "ss", "m", ToonGender.Female, 11, 0, 11, 11, 1, 2, 1, 2, 8, 0],
    false,
    ToonNpcType.Regular,
  ],
  4232: [
    4736,
    "Hedly Hymn",
    ["hss", "ls", "m", ToonGender.Male, 3, 0, 3, 3, 1, 2, 1, 2, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  4233: [
    4737,
    "Charlie Carp",
    ["cll", "ms", "m", ToonGender.Male, 17, 0, 17, 17, 1, 2, 1, 2, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  4234: [
    4738,
    "Leed Guitar",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4235: [
    4240,
    "Fisherman Larry",
    ["cls", "ls", "m", ToonGender.Male, 3, 0, 3, 3, 1, 3, 1, 3, 1, 16],
    false,
    ToonNpcType.Fisherman,
  ],
  4301: [
    4819,
    "Yuki",
    ["fss", "md", "l", ToonGender.Female, 12, 0, 12, 12, 1, 2, 1, 2, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  4302: [
    4821,
    "Anna",
    ["fls", "ls", "l", ToonGender.Female, 3, 0, 3, 3, 1, 2, 1, 2, 2, 3],
    false,
    ToonNpcType.Regular,
  ],
  4303: [
    4853,
    "Leo",
    ["rsl", "ss", "l", ToonGender.Male, 18, 0, 18, 18, 1, 2, 1, 2, 0, 18],
    false,
    ToonNpcType.Regular,
  ],
  4304: [
    4873,
    "HQ Officer",
    ["rss", "ls", "m", ToonGender.Male, 12, 0, 12, 12, 0, 2, 0, 2, 0, 15],
    false,
    ToonNpcType.HQ,
  ],
  4305: [
    4873,
    "HQ Officer",
    ["mss", "sd", "m", ToonGender.Female, 3, 0, 3, 3, 0, 4, 0, 4, 26, 27],
    false,
    ToonNpcType.HQ,
  ],
  4306: [
    4873,
    "HQ Officer",
    ["hll", "ms", "m", ToonGender.Female, 19, 0, 19, 19, 0, 5, 0, 5, 4, 25],
    false,
    ToonNpcType.HQ,
  ],
  4307: [
    4873,
    "HQ Officer",
    ["hsl", "ld", "m", ToonGender.Female, 11, 0, 11, 11, 0, 5, 0, 5, 17, 27],
    false,
    ToonNpcType.HQ,
  ],
  4308: [
    4835,
    "Tabitha",
    ["css", "md", "m", ToonGender.Female, 6, 0, 6, 6, 3, 5, 3, 5, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  4309: [
    4801,
    "Marshall",
    ["cll", "ms", "m", ToonGender.Male, 18, 0, 18, 18, 0, 4, 0, 4, 0, 17],
    false,
    ToonNpcType.Regular,
  ],
  4310: [
    4803,
    "Martha Mopp",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  4311: [
    4804,
    "Sea Shanty",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  4312: [
    4807,
    "Moe Saj",
    ["dsl", "ms", "m", ToonGender.Male, 18, 0, 18, 18, 1, 5, 1, 5, 0, 9],
    false,
    ToonNpcType.Regular,
  ],
  4313: [
    4809,
    "Dumb Dolph",
    ["dss", "ss", "m", ToonGender.Male, 10, 0, 10, 10, 1, 5, 1, 5, 0, 2],
    false,
    ToonNpcType.Regular,
  ],
  4314: [
    4817,
    "Dana Dander",
    ["fll", "ld", "m", ToonGender.Female, 2, 0, 2, 2, 1, 8, 1, 8, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  4315: [
    4827,
    "Karen Clockwork",
    ["fss", "sd", "m", ToonGender.Female, 18, 0, 18, 18, 1, 9, 1, 9, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4316: [
    4828,
    "Tim Tango",
    ["fls", "ss", "m", ToonGender.Male, 9, 0, 9, 9, 1, 6, 1, 6, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  4317: [
    4829,
    "Stubby Toe",
    ["rsl", "ls", "l", ToonGender.Male, 3, 0, 3, 3, 0, 7, 0, 7, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  4318: [
    4836,
    "Bob Marlin",
    ["rss", "ms", "l", ToonGender.Male, 17, 0, 17, 17, 0, 8, 0, 8, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  4319: [
    4838,
    "Rinky Dink",
    ["mss", "ls", "l", ToonGender.Female, 10, 0, 10, 10, 0, 12, 0, 12, 1, 23],
    false,
    ToonNpcType.Regular,
  ],
  4320: [
    4840,
    "Cammy Coda",
    ["mls", "ss", "l", ToonGender.Female, 1, 0, 1, 1, 0, 21, 0, 21, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  4321: [
    4841,
    "Luke Lute",
    ["hsl", "ls", "l", ToonGender.Male, 17, 0, 17, 17, 0, 9, 0, 9, 0, 16],
    false,
    ToonNpcType.Regular,
  ],
  4322: [
    4842,
    "Randy Rythm",
    ["hls", "ms", "l", ToonGender.Male, 9, 0, 9, 9, 0, 9, 0, 9, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  4323: [
    4844,
    "Hanna Hogg",
    ["cll", "ss", "l", ToonGender.Female, 1, 0, 1, 1, 1, 21, 1, 21, 24, 27],
    false,
    ToonNpcType.Regular,
  ],
  4324: [
    4845,
    "Ellie",
    ["css", "ld", "l", ToonGender.Female, 17, 0, 17, 17, 1, 22, 1, 22, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  4325: [
    4848,
    "Banker Bran",
    ["cls", "ms", "l", ToonGender.Male, 9, 0, 9, 9, 1, 9, 1, 9, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  4326: [
    4850,
    "Fran Fret",
    ["dsl", "ms", "l", ToonGender.Female, 1, 0, 1, 1, 1, 23, 1, 23, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  4327: [
    4852,
    "Flim Flam",
    ["dss", "ld", "l", ToonGender.Female, 16, 0, 16, 16, 1, 23, 1, 23, 7, 1],
    false,
    ToonNpcType.Regular,
  ],
  4328: [
    4854,
    "Wagner",
    ["fll", "ms", "l", ToonGender.Male, 8, 0, 8, 8, 1, 11, 1, 11, 0, 12],
    false,
    ToonNpcType.Regular,
  ],
  4329: [
    4855,
    "Telly Prompter",
    ["fsl", "ls", "l", ToonGender.Female, 24, 0, 24, 24, 0, 25, 0, 25, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  4330: [4862, "Quentin", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  4331: [
    4867,
    "Mellow Costello",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  4332: [
    4870,
    "Ziggy",
    ["rss", "ms", "l", ToonGender.Male, 22, 0, 22, 22, 0, 27, 0, 27, 0, 17],
    false,
    ToonNpcType.Regular,
  ],
  4333: [
    4871,
    "Harry",
    ["mss", "ss", "l", ToonGender.Male, 15, 0, 15, 15, 0, 27, 0, 27, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  4334: [
    4872,
    "Fast Freddie",
    ["mls", "ls", "l", ToonGender.Male, 8, 0, 8, 8, 0, 0, 0, 0, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  4335: [
    4345,
    "Fisherman Walden",
    ["hsl", "ms", "l", ToonGender.Male, 22, 0, 22, 22, 1, 0, 1, 0, 0, 6],
    false,
    ToonNpcType.Fisherman,
  ],
  5001: [
    5502,
    "HQ Officer",
    ["fls", "ls", "s", ToonGender.Male, 14, 0, 14, 14, 1, 7, 1, 7, 0, 20],
    false,
    ToonNpcType.HQ,
  ],
  5002: [
    5502,
    "HQ Officer",
    ["rll", "ms", "s", ToonGender.Male, 6, 0, 6, 6, 0, 8, 0, 8, 0, 17],
    false,
    ToonNpcType.HQ,
  ],
  5003: [
    5502,
    "HQ Officer",
    ["rss", "ms", "s", ToonGender.Female, 22, 0, 22, 22, 0, 12, 0, 12, 26, 27],
    false,
    ToonNpcType.HQ,
  ],
  5004: [
    5502,
    "HQ Officer",
    ["rls", "ld", "s", ToonGender.Female, 13, 0, 13, 13, 0, 21, 0, 21, 4, 11],
    false,
    ToonNpcType.HQ,
  ],
  5005: [
    5501,
    "Clerk Peaches",
    ["mls", "md", "s", ToonGender.Female, 6, 0, 6, 6, 0, 21, 0, 21, 2, 3],
    false,
    ToonNpcType.Clerk,
  ],
  5006: [
    5501,
    "Clerk Herb",
    ["hsl", "ms", "s", ToonGender.Male, 20, 0, 20, 20, 0, 9, 0, 9, 0, 1],
    false,
    ToonNpcType.Clerk,
  ],
  5007: [
    5503,
    "Bonnie Blossom",
    ["hss", "ss", "s", ToonGender.Female, 13, 0, 13, 13, 0, 22, 0, 22, 3, 2],
    false,
    ToonNpcType.Tailor,
  ],
  5008: [
    5000,
    "Fisherman Flora",
    ["cll", "md", "s", ToonGender.Female, 4, 0, 4, 4, 1, 22, 1, 22, 19, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  5009: [
    5505,
    "Clerk Bo Tanny",
    ["csl", "ls", "m", ToonGender.Female, 21, 0, 21, 21, 1, 23, 1, 23, 8, 23],
    false,
    ToonNpcType.Petclerk,
  ],
  5010: [
    5505,
    "Clerk Tom A. Dough",
    ["cls", "ss", "m", ToonGender.Male, 13, 0, 13, 13, 1, 10, 1, 10, 0, 10],
    false,
    ToonNpcType.Petclerk,
  ],
  5011: [
    5505,
    "Clerk Doug Wood",
    ["dll", "ls", "m", ToonGender.Male, 5, 0, 5, 5, 1, 10, 1, 10, 0, 4],
    false,
    ToonNpcType.Petclerk,
  ],
  5012: [
    5000,
    "Party Planner Pierce",
    ["dls", "ms", "m", ToonGender.Male, 13, 0, 12, 12, 0, 1, 0, 1, 0, 6],
    true,
    ToonNpcType.Partyperson,
  ],
  5013: [
    5000,
    "Party Planner Peggy",
    ["dss", "md", "m", ToonGender.Female, 1, 0, 3, 3, 1, 5, 1, 5, 0, 5],
    true,
    ToonNpcType.Partyperson,
  ],
  5101: [
    5602,
    "Artie",
    ["dsl", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 1, 4, 1, 4, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  5102: [5610, "Susan", ["r", ToonGender.Female], false, ToonNpcType.Regular],
  5103: [
    5615,
    "Bud",
    ["fll", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 1, 5, 1, 5, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  5104: [
    5617,
    "Flutterby",
    ["fsl", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 1, 5, 1, 5, 0, 19],
    false,
    ToonNpcType.Regular,
  ],
  5105: [5619, "Jack", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  5106: [
    5613,
    "Barber Bjorn",
    ["rsl", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 1, 6, 1, 6, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  5107: [
    5607,
    "Postman Felipe",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  5108: [
    5616,
    "Innkeeper Janet",
    ["mss", "ls", "l", ToonGender.Female, 2, 0, 2, 2, 0, 11, 0, 11, 24, 27],
    false,
    ToonNpcType.Regular,
  ],
  5109: [
    5627,
    "HQ Officer",
    ["mls", "ss", "l", ToonGender.Male, 17, 0, 17, 17, 0, 7, 0, 7, 0, 0],
    true,
    ToonNpcType.HQ,
  ],
  5110: [
    5627,
    "HQ Officer",
    ["hsl", "ls", "l", ToonGender.Male, 10, 0, 10, 10, 0, 8, 0, 8, 0, 18],
    true,
    ToonNpcType.HQ,
  ],
  5111: [
    5627,
    "HQ Officer",
    ["hss", "ls", "l", ToonGender.Female, 2, 0, 2, 2, 0, 12, 0, 12, 7, 4],
    true,
    ToonNpcType.HQ,
  ],
  5112: [
    5627,
    "HQ Officer",
    ["cll", "ms", "l", ToonGender.Female, 17, 0, 17, 17, 0, 21, 0, 21, 14, 27],
    true,
    ToonNpcType.HQ,
  ],
  5113: [
    5601,
    "Dr. Spud",
    ["css", "ld", "l", ToonGender.Female, 10, 0, 10, 10, 0, 21, 0, 21, 3, 2],
    false,
    ToonNpcType.Regular,
  ],
  5114: [
    5603,
    "Wilt",
    ["cls", "ms", "l", ToonGender.Male, 2, 0, 2, 2, 1, 9, 1, 9, 0, 2],
    false,
    ToonNpcType.Regular,
  ],
  5115: [
    5604,
    "Honey Dew",
    ["dsl", "ms", "l", ToonGender.Female, 17, 0, 17, 17, 1, 22, 1, 22, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  5116: [
    5605,
    "Vegetable Vern",
    ["dss", "ls", "l", ToonGender.Male, 9, 0, 9, 9, 1, 9, 1, 9, 0, 17],
    false,
    ToonNpcType.Regular,
  ],
  5117: [
    5606,
    "Petal",
    ["fll", "md", "l", ToonGender.Female, 1, 0, 1, 1, 1, 23, 1, 23, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  5118: [
    5608,
    "Pop Corn",
    ["fsl", "ms", "l", ToonGender.Male, 16, 0, 16, 16, 1, 10, 1, 10, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  5119: [
    5609,
    "Barry Medly",
    ["fls", "ss", "l", ToonGender.Male, 9, 0, 9, 9, 1, 10, 1, 10, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  5120: [
    5611,
    "Gopher",
    ["rsl", "ss", "l", ToonGender.Male, 22, 0, 22, 22, 1, 3, 1, 3, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  5121: [
    5618,
    "Paula Peapod",
    ["rss", "ss", "l", ToonGender.Female, 23, 0, 23, 23, 1, 9, 1, 9, 0, 25],
    false,
    ToonNpcType.Regular,
  ],
  5122: [5620, "Leif Pyle", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  5123: [
    5621,
    "Diane Vine",
    ["mls", "sd", "m", ToonGender.Female, 7, 0, 7, 7, 1, 11, 1, 11, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  5124: [
    5622,
    "Soggy Bottom",
    ["hll", "ss", "m", ToonGender.Male, 21, 0, 21, 21, 0, 8, 0, 8, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  5125: [
    5623,
    "Sanjay Splash",
    ["hss", "ls", "m", ToonGender.Male, 14, 0, 14, 14, 0, 9, 0, 9, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  5126: [
    5624,
    "Madam Mum",
    ["hls", "sd", "m", ToonGender.Female, 7, 0, 7, 7, 0, 21, 0, 21, 14, 27],
    false,
    ToonNpcType.Regular,
  ],
  5127: [
    5625,
    "Polly Pollen",
    ["csl", "ms", "m", ToonGender.Female, 23, 0, 23, 23, 0, 22, 0, 22, 2, 2],
    false,
    ToonNpcType.Regular,
  ],
  5128: [
    5626,
    "Shoshanna Sap",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5129: [
    5139,
    "Fisherman Sally",
    ["dll", "md", "m", ToonGender.Female, 7, 0, 7, 7, 0, 23, 0, 23, 17, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  5201: [
    5702,
    "Jake",
    ["hls", "ls", "l", ToonGender.Male, 15, 0, 15, 15, 1, 10, 1, 10, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  5202: [
    5703,
    "Cynthia",
    ["cll", "ls", "l", ToonGender.Female, 7, 0, 7, 7, 1, 23, 1, 23, 11, 27],
    false,
    ToonNpcType.Regular,
  ],
  5203: [
    5704,
    "Lisa",
    ["css", "ss", "l", ToonGender.Female, 23, 0, 23, 23, 1, 24, 1, 24, 19, 27],
    false,
    ToonNpcType.Regular,
  ],
  5204: [
    5726,
    "Bert",
    ["cls", "ls", "l", ToonGender.Male, 14, 0, 14, 14, 0, 12, 0, 12, 1, 4],
    false,
    ToonNpcType.Regular,
  ],
  5205: [
    5718,
    "Dan D. Lion",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  5206: [
    5720,
    "Vine Green",
    ["dss", "ss", "l", ToonGender.Male, 21, 0, 21, 21, 0, 27, 0, 27, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  5207: [
    5717,
    "Sofie Squirt",
    ["fll", "ld", "l", ToonGender.Female, 14, 0, 14, 14, 0, 27, 0, 27, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  5208: [
    5719,
    "Samantha Spade",
    ["fsl", "sd", "l", ToonGender.Female, 7, 0, 7, 7, 0, 27, 0, 27, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  5209: [
    5728,
    "HQ Officer",
    ["fls", "ss", "l", ToonGender.Male, 21, 0, 21, 21, 0, 0, 0, 0, 1, 9],
    true,
    ToonNpcType.HQ,
  ],
  5210: [
    5728,
    "HQ Officer",
    ["rsl", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 1, 0, 1, 0, 1, 2],
    true,
    ToonNpcType.HQ,
  ],
  5211: [
    5728,
    "HQ Officer",
    ["rss", "md", "l", ToonGender.Female, 6, 0, 6, 6, 1, 1, 1, 1, 23, 27],
    true,
    ToonNpcType.HQ,
  ],
  5212: [
    5728,
    "HQ Officer",
    ["mss", "ls", "l", ToonGender.Female, 22, 0, 22, 22, 1, 1, 1, 1, 10, 27],
    true,
    ToonNpcType.HQ,
  ],
  5213: [
    5701,
    "Big Galoot",
    ["mls", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 1, 1, 1, 1, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  5214: [
    5705,
    "Itchie Bumps",
    ["hsl", "md", "l", ToonGender.Female, 6, 0, 6, 6, 1, 2, 1, 2, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  5215: [
    5706,
    "Tammy Tuber",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5216: [
    5707,
    "Stinky Jim",
    ["cll", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 0, 2, 0, 2, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  5217: [
    5708,
    "Greg Greenethumb",
    ["csl", "ls", "l", ToonGender.Male, 5, 0, 5, 5, 0, 3, 0, 3, 1, 19],
    false,
    ToonNpcType.Regular,
  ],
  5218: [
    5709,
    "Rocky Raspberry",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  5219: [
    5710,
    "Lars Bicep",
    ["dsl", "ss", "l", ToonGender.Male, 13, 0, 13, 13, 0, 3, 0, 3, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  5220: [
    5711,
    "Lacy Underalls",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5221: [
    5712,
    "Pink Flamingo",
    ["fll", "md", "l", ToonGender.Female, 21, 0, 21, 21, 0, 6, 0, 6, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  5222: [
    5713,
    "Whiny Wilma",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5223: [
    5714,
    "Wet Will",
    ["fls", "ss", "s", ToonGender.Male, 5, 0, 5, 5, 1, 4, 1, 4, 1, 18],
    false,
    ToonNpcType.Regular,
  ],
  5224: [
    5715,
    "Uncle Bumpkin",
    ["rll", "ls", "s", ToonGender.Male, 19, 0, 19, 19, 1, 5, 1, 5, 1, 15],
    false,
    ToonNpcType.Regular,
  ],
  5225: [
    5716,
    "Pamela Puddle",
    ["rss", "sd", "s", ToonGender.Female, 12, 0, 12, 12, 1, 7, 1, 7, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  5226: [
    5721,
    "Pete Moss",
    ["rls", "ss", "s", ToonGender.Male, 4, 0, 4, 4, 1, 5, 1, 5, 1, 9],
    false,
    ToonNpcType.Regular,
  ],
  5227: [
    5725,
    "Begonia Biddlesmore",
    ["mls", "ld", "s", ToonGender.Female, 19, 0, 19, 19, 1, 8, 1, 8, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  5228: [
    5727,
    "Digger Mudhands",
    ["hsl", "ms", "s", ToonGender.Male, 12, 0, 12, 12, 1, 6, 1, 6, 1, 20],
    false,
    ToonNpcType.Regular,
  ],
  5229: [
    5245,
    "Fisherman Lily",
    ["hss", "ms", "s", ToonGender.Female, 3, 0, 3, 3, 0, 11, 0, 11, 16, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  5301: [
    5802,
    "HQ Officer",
    ["rss", "ms", "l", ToonGender.Female, 13, 0, 13, 13, 0, 11, 0, 11, 1, 12],
    true,
    ToonNpcType.HQ,
  ],
  5302: [
    5802,
    "HQ Officer",
    ["mss", "ss", "l", ToonGender.Female, 4, 0, 4, 4, 0, 12, 0, 12, 17, 27],
    true,
    ToonNpcType.HQ,
  ],
  5303: [
    5802,
    "HQ Officer",
    ["hll", "ls", "l", ToonGender.Male, 19, 0, 19, 19, 1, 8, 1, 8, 1, 18],
    true,
    ToonNpcType.HQ,
  ],
  5304: [
    5802,
    "HQ Officer",
    ["hsl", "ls", "l", ToonGender.Female, 12, 0, 12, 12, 1, 12, 1, 12, 19, 27],
    true,
    ToonNpcType.HQ,
  ],
  5305: [
    5804,
    "Crystal",
    ["hls", "ss", "l", ToonGender.Female, 4, 0, 4, 4, 1, 21, 1, 21, 16, 27],
    false,
    ToonNpcType.Regular,
  ],
  5306: [5805, "S. Cargo", ["r", ToonGender.Male], false, ToonNpcType.Regular],
  5307: [
    5809,
    "Fun Gus",
    ["css", "ms", "l", ToonGender.Male, 12, 0, 12, 12, 1, 9, 1, 9, 1, 2],
    false,
    ToonNpcType.Regular,
  ],
  5308: [
    5810,
    "Naggy Nell",
    ["cls", "ms", "l", ToonGender.Female, 4, 0, 4, 4, 1, 22, 1, 22, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  5309: [
    5811,
    "Ro Maine",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5310: [
    5815,
    "Timothy",
    ["dls", "ms", "l", ToonGender.Male, 12, 0, 12, 12, 0, 11, 0, 11, 1, 14],
    false,
    ToonNpcType.Regular,
  ],
  5311: [
    5817,
    "Judge McIntosh",
    ["fll", "ms", "m", ToonGender.Female, 3, 0, 3, 3, 0, 24, 0, 24, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  5312: [
    5819,
    "Eugene",
    ["fss", "ss", "m", ToonGender.Male, 18, 0, 18, 18, 0, 12, 0, 12, 1, 6],
    false,
    ToonNpcType.Regular,
  ],
  5313: [
    5821,
    "Coach Zucchini",
    ["fls", "ls", "m", ToonGender.Male, 10, 0, 10, 10, 0, 12, 0, 12, 1, 1],
    false,
    ToonNpcType.Regular,
  ],
  5314: [
    5826,
    "Aunt Hill",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  5315: [
    5827,
    "Uncle Mud",
    ["rss", "ss", "m", ToonGender.Male, 18, 0, 18, 18, 1, 12, 1, 12, 1, 16],
    false,
    ToonNpcType.Regular,
  ],
  5316: [
    5828,
    "Uncle Spud",
    ["mss", "ls", "m", ToonGender.Male, 10, 0, 10, 10, 1, 12, 1, 12, 1, 13],
    false,
    ToonNpcType.Regular,
  ],
  5317: [
    5830,
    "Detective Lima",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  5318: [
    5833,
    "Caesar",
    ["hsl", "ss", "m", ToonGender.Male, 18, 0, 18, 18, 1, 0, 1, 0, 1, 4],
    false,
    ToonNpcType.Regular,
  ],
  5319: [5835, "Rose", ["r", ToonGender.Female], false, ToonNpcType.Regular],
  5320: [
    5836,
    "April",
    ["cll", "sd", "m", ToonGender.Female, 2, 0, 2, 2, 1, 1, 1, 1, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  5321: [
    5837,
    "Professor Ivy",
    ["css", "ms", "m", ToonGender.Female, 18, 0, 18, 18, 1, 1, 1, 1, 17, 27],
    false,
    ToonNpcType.Regular,
  ],
  5322: [
    5318,
    "Fisherman Rose",
    ["cls", "ss", "m", ToonGender.Female, 10, 0, 10, 10, 0, 2, 0, 2, 11, 27],
    false,
    ToonNpcType.Fisherman,
  ],
  8001: [
    8501,
    "Graham Pree",
    ["psl", "ms", "m", ToonGender.Male, 13, 0, 13, 13, 0, 11, 0, 11, 2, 10],
    false,
    ToonNpcType.Kartclerk,
  ],
  8002: [
    8501,
    "Ivona Race",
    ["psl", "ld", "s", ToonGender.Female, 23, 0, 23, 23, 0, 11, 0, 11, 2, 10],
    false,
    ToonNpcType.Kartclerk,
  ],
  8003: [
    8501,
    "Anita Winn",
    ["pll", "ss", "l", ToonGender.Female, 1, 0, 1, 1, 0, 11, 0, 11, 2, 10],
    false,
    ToonNpcType.Kartclerk,
  ],
  8004: [
    8501,
    "Phil Errup",
    ["pls", "ms", "l", ToonGender.Male, 16, 0, 16, 16, 0, 11, 0, 11, 2, 10],
    false,
    ToonNpcType.Kartclerk,
  ],
  9001: [
    9503,
    "Snoozin' Susan",
    ["fll", "ss", "l", ToonGender.Female, 16, 0, 16, 16, 0, 6, 0, 6, 26, 27],
    false,
    ToonNpcType.Regular,
  ],
  9002: [
    9502,
    "Sleeping Tom",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  9003: [
    9501,
    "Drowsy Dennis",
    ["fls", "ms", "l", ToonGender.Male, 22, 0, 22, 22, 1, 5, 1, 5, 0, 14],
    false,
    ToonNpcType.Regular,
  ],
  9004: [
    9505,
    "HQ Officer",
    ["rll", "ms", "l", ToonGender.Female, 16, 0, 16, 16, 1, 7, 1, 7, 3, 8],
    true,
    ToonNpcType.HQ,
  ],
  9005: [
    9505,
    "HQ Officer",
    ["rss", "ld", "l", ToonGender.Female, 9, 0, 9, 9, 1, 8, 1, 8, 19, 27],
    true,
    ToonNpcType.HQ,
  ],
  9006: [
    9505,
    "HQ Officer",
    ["rls", "ms", "l", ToonGender.Male, 22, 0, 22, 22, 1, 6, 1, 6, 0, 1],
    true,
    ToonNpcType.HQ,
  ],
  9007: [
    9505,
    "HQ Officer",
    ["mls", "ms", "l", ToonGender.Male, 15, 0, 15, 15, 1, 6, 1, 6, 0, 19],
    true,
    ToonNpcType.HQ,
  ],
  9008: [
    9504,
    "Clerk Jill",
    ["hll", "ss", "l", ToonGender.Female, 8, 0, 8, 8, 1, 9, 1, 9, 12, 27],
    false,
    ToonNpcType.Clerk,
  ],
  9009: [
    9504,
    "Clerk Phil",
    ["hss", "ls", "l", ToonGender.Male, 22, 0, 22, 22, 0, 7, 0, 7, 0, 13],
    false,
    ToonNpcType.Clerk,
  ],
  9010: [
    9506,
    "Worn Out Waylon",
    ["cll", "ms", "l", ToonGender.Male, 15, 0, 15, 15, 0, 8, 0, 8, 0, 10],
    false,
    ToonNpcType.Tailor,
  ],
  9011: [
    9000,
    "Fisherman Freud",
    ["csl", "ss", "l", ToonGender.Male, 7, 0, 7, 7, 0, 8, 0, 8, 0, 4],
    false,
    ToonNpcType.Fisherman,
  ],
  9012: [
    9508,
    "Clerk Sarah Snuze",
    ["cls", "ld", "l", ToonGender.Female, 23, 0, 23, 23, 0, 21, 0, 21, 10, 27],
    false,
    ToonNpcType.Petclerk,
  ],
  9013: [
    9508,
    "Clerk Kat Knap",
    ["dll", "sd", "l", ToonGender.Female, 15, 0, 15, 15, 0, 21, 0, 21, 10, 27],
    false,
    ToonNpcType.Petclerk,
  ],
  9014: [
    9508,
    "Clerk R. V. Winkle",
    ["dss", "ss", "l", ToonGender.Male, 7, 0, 7, 7, 0, 9, 0, 9, 1, 15],
    false,
    ToonNpcType.Petclerk,
  ],
  9015: [
    9000,
    "Party Planner Pebbles",
    ["rss", "ls", "l", ToonGender.Male, 21, 0, 20, 20, 0, 12, 0, 12, 0, 11],
    true,
    ToonNpcType.Partyperson,
  ],
  9016: [
    9000,
    "Party Planner Pearl",
    ["rls", "md", "l", ToonGender.Female, 6, 0, 21, 21, 1, 11, 1, 11, 0, 11],
    true,
    ToonNpcType.Partyperson,
  ],
  9101: [
    9604,
    "Ed",
    ["css", "ls", "l", ToonGender.Male, 14, 0, 14, 14, 1, 1, 1, 1, 0, 11],
    false,
    ToonNpcType.Regular,
  ],
  9102: [
    9607,
    "Big Mama",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  9103: [
    9620,
    "P.J.",
    ["dsl", "ss", "l", ToonGender.Male, 20, 0, 20, 20, 0, 2, 0, 2, 0, 1],
    false,
    ToonNpcType.Regular,
  ],
  9104: [
    9642,
    "Sweet Slumber",
    ["dss", "ld", "l", ToonGender.Female, 14, 0, 14, 14, 0, 3, 0, 3, 0, 23],
    false,
    ToonNpcType.Regular,
  ],
  9105: [
    9609,
    "Professor Yawn",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  9106: [
    9619,
    "Max",
    ["fsl", "ss", "l", ToonGender.Male, 20, 0, 20, 20, 0, 3, 0, 3, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  9107: [
    9601,
    "Snuggles",
    ["fls", "ld", "l", ToonGender.Female, 13, 0, 13, 13, 0, 5, 0, 5, 3, 2],
    false,
    ToonNpcType.Regular,
  ],
  9108: [
    9602,
    "Winky Wilbur",
    ["rll", "ms", "l", ToonGender.Male, 6, 0, 6, 6, 1, 4, 1, 4, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  9109: [
    9605,
    "Dreamy Daphne",
    ["rss", "ls", "l", ToonGender.Female, 22, 0, 22, 22, 1, 6, 1, 6, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  9110: [
    9608,
    "Kathy Nip",
    ["mss", "ss", "l", ToonGender.Female, 13, 0, 13, 13, 1, 6, 1, 6, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  9111: [
    9616,
    "Powers Erge",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  9112: [
    9617,
    "Lullaby Lou",
    ["hsl", "ms", "m", ToonGender.Male, 19, 0, 19, 19, 1, 5, 1, 5, 0, 12],
    false,
    ToonNpcType.Regular,
  ],
  9113: [
    9622,
    "Jacques Clock",
    ["hss", "ss", "m", ToonGender.Male, 13, 0, 13, 13, 1, 5, 1, 5, 0, 9],
    false,
    ToonNpcType.Regular,
  ],
  9114: [
    9625,
    "Smudgy Mascara",
    ["cll", "ld", "m", ToonGender.Female, 4, 0, 4, 4, 0, 8, 0, 8, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  9115: [
    9626,
    "Babyface MacDougal",
    ["r", ToonGender.Male],
    false,
    ToonNpcType.Regular,
  ],
  9116: [
    9627,
    "Dances with Sheep",
    ["cls", "ss", "m", ToonGender.Male, 12, 0, 12, 12, 0, 7, 0, 7, 0, 17],
    false,
    ToonNpcType.Regular,
  ],
  9117: [
    9628,
    "Afta Hours",
    ["dsl", "ld", "m", ToonGender.Female, 4, 0, 4, 4, 0, 11, 0, 11, 2, 9],
    false,
    ToonNpcType.Regular,
  ],
  9118: [
    9629,
    "Starry Knight",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  9119: [
    9630,
    "Rocco",
    ["fll", "ms", "m", ToonGender.Male, 12, 0, 12, 12, 0, 8, 0, 8, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  9120: [
    9631,
    "Sarah Slumber",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  9121: [
    9634,
    "Serena Shortsheeter",
    ["fls", "md", "m", ToonGender.Female, 19, 0, 19, 19, 1, 12, 1, 12, 16, 27],
    false,
    ToonNpcType.Regular,
  ],
  9122: [
    9636,
    "Puffy Ayes",
    ["rll", "ms", "m", ToonGender.Male, 12, 0, 12, 12, 1, 8, 1, 8, 0, 16],
    false,
    ToonNpcType.Regular,
  ],
  9123: [
    9639,
    "Teddy Blair",
    ["rss", "ss", "m", ToonGender.Male, 4, 0, 4, 4, 1, 9, 1, 9, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  9124: [
    9640,
    "Nina Nitelight",
    ["rls", "md", "m", ToonGender.Female, 19, 0, 19, 19, 1, 22, 1, 22, 8, 9],
    false,
    ToonNpcType.Regular,
  ],
  9125: [
    9643,
    "Dr. Bleary",
    ["mls", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 1, 9, 1, 9, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  9126: [
    9644,
    "Wyda Wake",
    ["hsl", "ms", "l", ToonGender.Female, 3, 0, 3, 3, 1, 23, 1, 23, 23, 27],
    false,
    ToonNpcType.Regular,
  ],
  9127: [
    9645,
    "Tabby Tucker",
    ["hss", "ld", "l", ToonGender.Female, 19, 0, 19, 19, 0, 24, 0, 24, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  9128: [
    9647,
    "Hardy O'Toole",
    ["cll", "ms", "l", ToonGender.Male, 10, 0, 10, 10, 0, 11, 0, 11, 0, 15],
    false,
    ToonNpcType.Regular,
  ],
  9129: [
    9649,
    "Bertha Bedhog",
    ["csl", "ms", "l", ToonGender.Female, 3, 0, 3, 3, 0, 25, 0, 25, 25, 27],
    false,
    ToonNpcType.Regular,
  ],
  9130: [
    9650,
    "Charlie Chamberpot",
    ["cls", "ss", "l", ToonGender.Male, 18, 0, 18, 18, 0, 12, 0, 12, 0, 9],
    false,
    ToonNpcType.Regular,
  ],
  9131: [
    9651,
    "Susan Siesta",
    ["r", ToonGender.Female],
    false,
    ToonNpcType.Regular,
  ],
  9132: [
    9652,
    "HQ Officer",
    ["dss", "ls", "l", ToonGender.Female, 2, 0, 2, 2, 0, 27, 0, 27, 0, 0],
    false,
    ToonNpcType.HQ,
  ],
  9133: [
    9652,
    "HQ Officer",
    ["dls", "ss", "l", ToonGender.Male, 17, 0, 17, 17, 1, 12, 1, 12, 0, 17],
    false,
    ToonNpcType.HQ,
  ],
  9134: [
    9652,
    "HQ Officer",
    ["fsl", "ls", "l", ToonGender.Male, 10, 0, 10, 10, 1, 0, 1, 0, 0, 14],
    false,
    ToonNpcType.HQ,
  ],
  9135: [
    9652,
    "HQ Officer",
    ["fls", "ms", "l", ToonGender.Male, 3, 0, 3, 3, 1, 0, 1, 0, 0, 11],
    false,
    ToonNpcType.HQ,
  ],
  9136: [
    9153,
    "Fisherman Taylor",
    ["rll", "ss", "l", ToonGender.Male, 17, 0, 17, 17, 1, 0, 1, 0, 1, 6],
    false,
    ToonNpcType.Fisherman,
  ],
  9201: [
    9752,
    "Bernie",
    ["psl", "ss", "m", ToonGender.Male, 9, 0, 9, 9, 17, 11, 0, 11, 7, 20],
    false,
    ToonNpcType.Regular,
  ],
  9202: [
    9703,
    "Orville",
    ["dss", "ss", "s", ToonGender.Male, 21, 0, 21, 21, 8, 3, 8, 3, 1, 17],
    false,
    ToonNpcType.Regular,
  ],
  9203: [
    9741,
    "Nat",
    ["pls", "ls", "s", ToonGender.Male, 5, 0, 5, 5, 37, 27, 26, 27, 7, 4],
    false,
    ToonNpcType.Regular,
  ],
  9204: [
    9704,
    "Claire de Loon",
    ["fsl", "sd", "s", ToonGender.Female, 19, 0, 19, 19, 21, 10, 0, 10, 8, 23],
    false,
    ToonNpcType.Regular,
  ],
  9205: [
    9736,
    "Zen Glen",
    ["dsl", "ms", "m", ToonGender.Male, 15, 0, 15, 15, 45, 27, 34, 27, 2, 17],
    false,
    ToonNpcType.Regular,
  ],
  9206: [
    9727,
    "Skinny Ginny",
    ["rls", "ld", "l", ToonGender.Female, 8, 0, 8, 8, 25, 27, 16, 27, 10, 27],
    false,
    ToonNpcType.Regular,
  ],
  9207: [
    9709,
    "Jane Drain",
    ["hss", "ss", "s", ToonGender.Female, 24, 0, 24, 24, 36, 27, 25, 27, 9, 27],
    false,
    ToonNpcType.Regular,
  ],
  9208: [
    9705,
    "Drowsy Dave",
    ["dsl", "ms", "s", ToonGender.Male, 20, 0, 20, 20, 46, 27, 35, 27, 6, 27],
    false,
    ToonNpcType.Regular,
  ],
  9209: [
    9706,
    "Dr. Floss",
    ["pll", "ss", "m", ToonGender.Male, 13, 0, 13, 13, 8, 12, 8, 12, 1, 12],
    false,
    ToonNpcType.Regular,
  ],
  9210: [
    9740,
    "Master Mike",
    ["hsl", "ls", "l", ToonGender.Male, 6, 0, 6, 6, 1, 0, 1, 0, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  9211: [
    9707,
    "Dawn",
    ["rll", "ss", "s", ToonGender.Female, 3, 0, 3, 3, 22, 22, 0, 22, 6, 22],
    false,
    ToonNpcType.Regular,
  ],
  9212: [
    9753,
    "Moonbeam",
    ["pss", "md", "m", ToonGender.Female, 16, 0, 16, 16, 45, 27, 34, 27, 0, 3],
    false,
    ToonNpcType.Regular,
  ],
  9213: [
    9711,
    "Rooster Rick",
    ["fsl", "ss", "m", ToonGender.Male, 2, 0, 2, 2, 37, 27, 26, 27, 7, 18],
    false,
    ToonNpcType.Regular,
  ],
  9214: [
    9710,
    "Dr. Blinky",
    ["rll", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 10, 27, 0, 27, 0, 13],
    false,
    ToonNpcType.Regular,
  ],
  9215: [
    9744,
    "Rip",
    ["csl", "ls", "l", ToonGender.Male, 18, 0, 18, 18, 11, 4, 0, 4, 0, 4],
    false,
    ToonNpcType.Regular,
  ],
  9216: [
    9725,
    "Cat",
    ["csl", "sd", "m", ToonGender.Female, 14, 0, 14, 14, 1, 7, 1, 7, 3, 7],
    false,
    ToonNpcType.Regular,
  ],
  9217: [
    9713,
    "Lawful Linda",
    ["mss", "ms", "m", ToonGender.Female, 17, 0, 17, 17, 20, 26, 0, 26, 5, 12],
    false,
    ToonNpcType.Regular,
  ],
  9218: [
    9737,
    "Waltzing Matilda",
    [
      "dss",
      "md",
      "l",
      ToonGender.Female,
      23,
      0,
      23,
      23,
      24,
      27,
      15,
      27,
      11,
      27,
    ],
    false,
    ToonNpcType.Regular,
  ],
  9219: [
    9712,
    "The Countess",
    ["hll", "sd", "l", ToonGender.Female, 10, 0, 10, 10, 9, 22, 9, 22, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  9220: [
    9716,
    "Grumpy Gordon",
    ["mls", "ms", "l", ToonGender.Male, 7, 0, 7, 7, 0, 27, 0, 27, 1, 10],
    false,
    ToonNpcType.Regular,
  ],
  9221: [
    9738,
    "Zari",
    ["fss", "md", "l", ToonGender.Female, 22, 0, 22, 22, 45, 27, 34, 27, 0, 6],
    false,
    ToonNpcType.Regular,
  ],
  9222: [
    9754,
    "Cowboy George",
    ["hsl", "ls", "l", ToonGender.Male, 10, 0, 10, 10, 52, 27, 41, 27, 12, 27],
    false,
    ToonNpcType.Regular,
  ],
  9223: [
    9714,
    "Mark the Lark",
    ["fsl", "ms", "m", ToonGender.Male, 20, 0, 20, 20, 43, 27, 32, 27, 0, 0],
    false,
    ToonNpcType.Regular,
  ],
  9224: [
    9718,
    "Sandy Sandman",
    ["css", "ms", "m", ToonGender.Female, 1, 0, 1, 1, 6, 8, 6, 8, 6, 8],
    false,
    ToonNpcType.Regular,
  ],
  9225: [
    9717,
    "Fidgety Bridget",
    ["rss", "md", "m", ToonGender.Female, 11, 0, 11, 11, 40, 27, 29, 27, 0, 27],
    false,
    ToonNpcType.Regular,
  ],
  9226: [
    9715,
    "William Teller",
    ["mls", "ms", "s", ToonGender.Male, 12, 0, 12, 12, 3, 10, 3, 10, 6, 10],
    false,
    ToonNpcType.Regular,
  ],
  9227: [
    9721,
    "Bed Head Ted",
    ["cls", "ss", "s", ToonGender.Male, 13, 0, 13, 13, 8, 5, 8, 5, 3, 18],
    false,
    ToonNpcType.Regular,
  ],
  9228: [
    9720,
    "Whispering Willow",
    ["fss", "sd", "s", ToonGender.Female, 4, 0, 4, 4, 15, 5, 11, 5, 8, 5],
    false,
    ToonNpcType.Regular,
  ],
  9229: [
    9708,
    "Rose Petals",
    ["css", "ld", "m", ToonGender.Female, 4, 0, 4, 4, 22, 21, 0, 21, 4, 21],
    false,
    ToonNpcType.Regular,
  ],
  9230: [
    9719,
    "Tex",
    ["mss", "ss", "s", ToonGender.Male, 8, 0, 8, 8, 53, 27, 42, 27, 13, 27],
    false,
    ToonNpcType.Regular,
  ],
  9231: [
    9722,
    "Harry Hammock",
    ["dll", "ss", "s", ToonGender.Male, 6, 0, 6, 6, 27, 27, 18, 27, 3, 8],
    false,
    ToonNpcType.Regular,
  ],
  9232: [
    9759,
    "Honey Moon",
    ["pss", "ld", "m", ToonGender.Female, 21, 0, 21, 21, 0, 27, 0, 27, 13, 27],
    false,
    ToonNpcType.Regular,
  ],
  9233: [
    9756,
    "HQ Officer",
    ["csl", "ls", "l", ToonGender.Female, 22, 0, 22, 22, 1, 7, 1, 7, 12, 27],
    false,
    ToonNpcType.HQ,
  ],
  9234: [
    9756,
    "HQ Officer",
    ["cls", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 1, 5, 1, 5, 0, 19],
    false,
    ToonNpcType.HQ,
  ],
  9235: [
    9756,
    "HQ Officer",
    ["dll", "ls", "l", ToonGender.Male, 6, 0, 6, 6, 1, 6, 1, 6, 0, 16],
    false,
    ToonNpcType.HQ,
  ],
  9236: [
    9756,
    "HQ Officer",
    ["dss", "ms", "l", ToonGender.Male, 20, 0, 20, 20, 0, 6, 0, 6, 0, 13],
    false,
    ToonNpcType.HQ,
  ],
  9237: [
    9255,
    "Fisherman Jung",
    ["dls", "ss", "l", ToonGender.Male, 14, 0, 14, 14, 0, 7, 0, 7, 0, 10],
    false,
    ToonNpcType.Fisherman,
  ],
  20000: [
    -1,
    "Tutorial Tom",
    ["dll", "ms", "m", ToonGender.Male, 7, 0, 7, 7, 2, 6, 2, 6, 2, 16],
    true,
    ToonNpcType.Regular,
  ],
  20001: [
    -1,
    "Flippy",
    ["dss", "ms", "m", ToonGender.Male, 17, 0, 17, 17, 3, 3, 3, 3, 7, 2],
    true,
    ToonNpcType.Blocker,
  ],
};

export const NPC_TOONS_BY_ZONE: Record<number, number[]> = {};
for (const [toonId, dna] of Object.entries(NPC_TOONS)) {
  const arr = NPC_TOONS_BY_ZONE[dna[0]] ?? [];
  arr.push(parseInt(toonId, 10));
  NPC_TOONS_BY_ZONE[dna[0]] = arr;
}

export const ALL_COLORS: ReadonlyArray<ReadonlyVec4> = [
  vec4.fromValues(1.0, 1.0, 1.0, 1.0), // 0
  vec4.fromValues(0.96875, 0.691406, 0.699219, 1.0), // 1
  vec4.fromValues(0.933594, 0.265625, 0.28125, 1.0), // 2
  vec4.fromValues(0.863281, 0.40625, 0.417969, 1.0), // 3
  vec4.fromValues(0.710938, 0.234375, 0.4375, 1.0), // 4
  vec4.fromValues(0.570312, 0.449219, 0.164062, 1.0), // 5
  vec4.fromValues(0.640625, 0.355469, 0.269531, 1.0), // 6
  vec4.fromValues(0.996094, 0.695312, 0.511719, 1.0), // 7
  vec4.fromValues(0.832031, 0.5, 0.296875, 1.0), // 8
  vec4.fromValues(0.992188, 0.480469, 0.167969, 1.0), // 9
  vec4.fromValues(0.996094, 0.898438, 0.320312, 1.0), // 10
  vec4.fromValues(0.996094, 0.957031, 0.597656, 1.0), // 11
  vec4.fromValues(0.855469, 0.933594, 0.492188, 1.0), // 12
  vec4.fromValues(0.550781, 0.824219, 0.324219, 1.0), // 13
  vec4.fromValues(0.242188, 0.742188, 0.515625, 1.0), // 14
  vec4.fromValues(0.304688, 0.96875, 0.402344, 1.0), // 15
  vec4.fromValues(0.433594, 0.90625, 0.835938, 1.0), // 16
  vec4.fromValues(0.347656, 0.820312, 0.953125, 1.0), // 17
  vec4.fromValues(0.191406, 0.5625, 0.773438, 1.0), // 18
  vec4.fromValues(0.558594, 0.589844, 0.875, 1.0), // 19
  vec4.fromValues(0.285156, 0.328125, 0.726562, 1.0), // 20
  vec4.fromValues(0.460938, 0.378906, 0.824219, 1.0), // 21
  vec4.fromValues(0.546875, 0.28125, 0.75, 1.0), // 22
  vec4.fromValues(0.726562, 0.472656, 0.859375, 1.0), // 23
  vec4.fromValues(0.898438, 0.617188, 0.90625, 1.0), // 24
  vec4.fromValues(0.7, 0.7, 0.8, 1.0), // 25
  vec4.fromValues(0.3, 0.3, 0.35, 1.0), // 26 black-ish cat
];

export const CLOTHES_COLORS: ReadonlyArray<ReadonlyVec4> = [
  // Boy shirts (0 - 12)
  vec4.fromValues(0.933594, 0.265625, 0.28125, 1.0), // (0) bright red
  vec4.fromValues(0.863281, 0.40625, 0.417969, 1.0), // (1) light red
  vec4.fromValues(0.710938, 0.234375, 0.4375, 1.0), // (2) plum
  vec4.fromValues(0.992188, 0.480469, 0.167969, 1.0), // (3) orange
  vec4.fromValues(0.996094, 0.898438, 0.320312, 1.0), // (4) yellow
  vec4.fromValues(0.550781, 0.824219, 0.324219, 1.0), // (5) light green
  vec4.fromValues(0.242188, 0.742188, 0.515625, 1.0), // (6) seafoam
  vec4.fromValues(0.433594, 0.90625, 0.835938, 1.0), // (7) light blue green
  vec4.fromValues(0.347656, 0.820312, 0.953125, 1.0), // (8) light blue
  vec4.fromValues(0.191406, 0.5625, 0.773438, 1.0), // (9) medium blue
  vec4.fromValues(0.285156, 0.328125, 0.726562, 1.0), // (10)
  vec4.fromValues(0.460938, 0.378906, 0.824219, 1.0), // (11) purple blue
  vec4.fromValues(0.546875, 0.28125, 0.75, 1.0), // (12) dark purple blue

  // Boy shorts
  vec4.fromValues(0.570312, 0.449219, 0.164062, 1.0),
  vec4.fromValues(0.640625, 0.355469, 0.269531, 1.0),
  vec4.fromValues(0.996094, 0.695312, 0.511719, 1.0),
  vec4.fromValues(0.832031, 0.5, 0.296875, 1.0),
  vec4.fromValues(0.992188, 0.480469, 0.167969, 1.0),
  vec4.fromValues(0.550781, 0.824219, 0.324219, 1.0),
  vec4.fromValues(0.433594, 0.90625, 0.835938, 1.0),
  vec4.fromValues(0.347656, 0.820312, 0.953125, 1.0),

  // Girl clothes
  vec4.fromValues(0.96875, 0.691406, 0.699219, 1.0), // (21) light pink
  vec4.fromValues(0.996094, 0.957031, 0.597656, 1.0), // (22) light yellow
  vec4.fromValues(0.855469, 0.933594, 0.492188, 1.0), // (23) light yellow green
  vec4.fromValues(0.558594, 0.589844, 0.875, 1.0), // (24) light purple
  vec4.fromValues(0.726562, 0.472656, 0.859375, 1.0), // (25) medium purple
  vec4.fromValues(0.898438, 0.617188, 0.90625, 1.0), // (26) purple

  // Special
  vec4.fromValues(1.0, 1.0, 1.0, 1.0), // (27) white

  // Pajama colors (not using these colors yet, possibly for gloves)
  vec4.fromValues(0.0, 0.2, 0.956862, 1.0), // (28) Blue Banana Pajama
  vec4.fromValues(0.972549, 0.094117, 0.094117, 1.0), // (29) Red Horn Pajama
  vec4.fromValues(0.447058, 0.0, 0.90196, 1.0), // (30) Purple Glasses Pajama
];

export const SHIRTS: ReadonlyArray<string> = [
  "phase_3/maps/desat_shirt_1.jpg", // 0 solid
  "phase_3/maps/desat_shirt_2.jpg", // 1 single stripe
  "phase_3/maps/desat_shirt_3.jpg", // 2 collar
  "phase_3/maps/desat_shirt_4.jpg", // 3 double stripe
  "phase_3/maps/desat_shirt_5.jpg", // 4 multiple stripes (boy)
  "phase_3/maps/desat_shirt_6.jpg", // 5 collar w/ pocket
  "phase_3/maps/desat_shirt_7.jpg", // 6 flower print (girl)
  "phase_3/maps/desat_shirt_8.jpg", // 7 special, flower trim (girl)
  "phase_3/maps/desat_shirt_9.jpg", // 8 hawaiian (boy)
  "phase_3/maps/desat_shirt_10.jpg", // 9 collar w/ 2 pockets
  "phase_3/maps/desat_shirt_11.jpg", // 10 bowling shirt
  "phase_3/maps/desat_shirt_12.jpg", // 11 special, vest (boy)
  "phase_3/maps/desat_shirt_13.jpg", // 12 special (no color), denim vest (girl)
  "phase_3/maps/desat_shirt_14.jpg", // 13 peasant (girl)
  "phase_3/maps/desat_shirt_15.jpg", // 14 collar w/ ruffles
  "phase_3/maps/desat_shirt_16.jpg", // 15 peasant w/ mid stripe (girl)
  "phase_3/maps/desat_shirt_17.jpg", // 16 special (no color), soccer jersey
  "phase_3/maps/desat_shirt_18.jpg", // 17 special, lightning bolt
  "phase_3/maps/desat_shirt_19.jpg", // 18 special, jersey 19 (boy)
  "phase_3/maps/desat_shirt_20.jpg", // 19 guayavera (boy)
  "phase_3/maps/desat_shirt_21.jpg", // 20 hearts (girl)
  "phase_3/maps/desat_shirt_22.jpg", // 21 special, stars (girl)
  "phase_3/maps/desat_shirt_23.jpg", // 22 flower (girl)

  // Catalog exclusive shirts
  "phase_4/maps/female_shirt1b.jpg", // 23 blue with 3 yellow stripes
  "phase_4/maps/female_shirt2.jpg", // 24 pink and beige with flower
  "phase_4/maps/female_shirt3.jpg", // 25 yellow hooded sweatshirt (also for boys)
  "phase_4/maps/male_shirt1.jpg", // 26 blue stripes
  "phase_4/maps/male_shirt2_palm.jpg", // 27 yellow with palm tree
  "phase_4/maps/male_shirt3c.jpg", // 28 orange

  // Halloween
  "phase_4/maps/shirt_ghost.jpg", // 29 ghost (Halloween)
  "phase_4/maps/shirt_pumkin.jpg", // 30 pumpkin (Halloween)

  // Winter holiday
  "phase_4/maps/holiday_shirt1.jpg", // 31 (Winter Holiday)
  "phase_4/maps/holiday_shirt2b.jpg", // 32 (Winter Holiday)
  "phase_4/maps/holidayShirt3b.jpg", // 33 (Winter Holiday)
  "phase_4/maps/holidayShirt4.jpg", // 34 (Winter Holiday)

  // Catalog 2 exclusive shirts
  "phase_4/maps/female_shirt1b.jpg", // 35 Blue and gold wavy stripes
  "phase_4/maps/female_shirt5New.jpg", // 36 Blue and pink with bow
  "phase_4/maps/shirtMale4B.jpg", // 37 Lime green with stripe
  "phase_4/maps/shirt6New.jpg", // 38 Purple with stars
  "phase_4/maps/shirtMaleNew7.jpg", // 39 Red kimono with checkerboard

  // Unused
  "phase_4/maps/femaleShirtNew6.jpg", // 40 Aqua kimono white stripe

  // Valentines
  "phase_4/maps/Vday1Shirt5.jpg", // 41 (Valentines)
  "phase_4/maps/Vday1Shirt6SHD.jpg", // 42 (Valentines)
  "phase_4/maps/Vday1Shirt4.jpg", // 43 (Valentines)
  "phase_4/maps/Vday_shirt2c.jpg", // 44 (Valentines)

  // Catalog 3 exclusive shirts
  "phase_4/maps/shirtTieDyeNew.jpg", // 45 Tie dye
  "phase_4/maps/male_shirt1.jpg", // 46 Light blue with blue and white stripe

  // St Patrick's Day shirts
  "phase_4/maps/StPats_shirt1.jpg", // 47 (St. Pats) Four leaf clover shirt
  "phase_4/maps/StPats_shirt2.jpg", // 48 (St. Pats) Pot o gold

  // T-Shirt Contest shirts
  "phase_4/maps/ContestfishingVestShirt2.jpg", // 49 (T-shirt Contest) Fishing Vest
  "phase_4/maps/ContestFishtankShirt1.jpg", // 50 (T-shirt Contest) Fish Tank
  "phase_4/maps/ContestPawShirt1.jpg", // 51 (T-shirt Contest) Paw Print

  // Catlog 4 exclusive shirts
  "phase_4/maps/CowboyShirt1.jpg", // 52 (Western) Cowboy Shirt
  "phase_4/maps/CowboyShirt2.jpg", // 53 (Western) Cowboy Shirt
  "phase_4/maps/CowboyShirt3.jpg", // 54 (Western) Cowboy Shirt
  "phase_4/maps/CowboyShirt4.jpg", // 55 (Western) Cowboy Shirt
  "phase_4/maps/CowboyShirt5.jpg", // 56 (Western) Cowboy Shirt
  "phase_4/maps/CowboyShirt6.jpg", // 57 (Western) Cowboy Shirt

  // July 4 shirts
  "phase_4/maps/4thJulyShirt1.jpg", // 58 (July 4th) Flag Shirt
  "phase_4/maps/4thJulyShirt2.jpg", // 59 (July 4th) Fireworks Shirt

  // Catalog 7 exclusive shirts
  "phase_4/maps/shirt_Cat7_01.jpg", // 60 Green w/ yellow buttons
  "phase_4/maps/shirt_Cat7_02.jpg", // 61 Purple w/ big flower

  // T-Shirt Contest 2 shirts
  "phase_4/maps/contest_backpack3.jpg", // 62 Multicolor shirt w/ backpack
  "phase_4/maps/contest_leder.jpg", // 63 Lederhosen
  "phase_4/maps/contest_mellon2.jpg", // 64 Watermelon
  "phase_4/maps/contest_race2.jpg", // 65 Race Shirt (UK winner)

  // Pajama shirts
  "phase_4/maps/PJBlueBanana2.jpg", // 66 Blue Banana PJ Shirt
  "phase_4/maps/PJRedHorn2.jpg", // 67 Red Horn PJ Shirt
  "phase_4/maps/PJGlasses2.jpg", // 68 Purple Glasses PJ Shirt

  // 2009 Valentines Day Shirts
  "phase_4/maps/tt_t_chr_avt_shirt_valentine1.jpg", // 69 Valentines Shirt 1
  "phase_4/maps/tt_t_chr_avt_shirt_valentine2.jpg", // 70 Valentines Shirt 2

  // Award Clothes
  "phase_4/maps/tt_t_chr_avt_shirt_desat4.jpg", // 71
  "phase_4/maps/tt_t_chr_avt_shirt_fishing1.jpg", // 72
  "phase_4/maps/tt_t_chr_avt_shirt_fishing2.jpg", // 73
  "phase_4/maps/tt_t_chr_avt_shirt_gardening1.jpg", // 74
  "phase_4/maps/tt_t_chr_avt_shirt_gardening2.jpg", // 75
  "phase_4/maps/tt_t_chr_avt_shirt_party1.jpg", // 76
  "phase_4/maps/tt_t_chr_avt_shirt_party2.jpg", // 77
  "phase_4/maps/tt_t_chr_avt_shirt_racing1.jpg", // 78
  "phase_4/maps/tt_t_chr_avt_shirt_racing2.jpg", // 79
  "phase_4/maps/tt_t_chr_avt_shirt_summer1.jpg", // 80
  "phase_4/maps/tt_t_chr_avt_shirt_summer2.jpg", // 81

  "phase_4/maps/tt_t_chr_avt_shirt_golf1.jpg", // 82
  "phase_4/maps/tt_t_chr_avt_shirt_golf2.jpg", // 83
  "phase_4/maps/tt_t_chr_avt_shirt_halloween1.jpg", // 84
  "phase_4/maps/tt_t_chr_avt_shirt_halloween2.jpg", // 85
  "phase_4/maps/tt_t_chr_avt_shirt_marathon1.jpg", // 86
  "phase_4/maps/tt_t_chr_avt_shirt_saveBuilding1.jpg", // 87
  "phase_4/maps/tt_t_chr_avt_shirt_saveBuilding2.jpg", // 88
  "phase_4/maps/tt_t_chr_avt_shirt_toonTask1.jpg", // 89
  "phase_4/maps/tt_t_chr_avt_shirt_toonTask2.jpg", // 90
  "phase_4/maps/tt_t_chr_avt_shirt_trolley1.jpg", // 91
  "phase_4/maps/tt_t_chr_avt_shirt_trolley2.jpg", // 92
  "phase_4/maps/tt_t_chr_avt_shirt_winter1.jpg", // 93
  "phase_4/maps/tt_t_chr_avt_shirt_halloween3.jpg", // 94
  "phase_4/maps/tt_t_chr_avt_shirt_halloween4.jpg", // 95
  // 2010 Valentines Day Shirts
  "phase_4/maps/tt_t_chr_avt_shirt_valentine3.jpg", // 96 Valentines Shirt 3

  // Scientist Shirts
  "phase_4/maps/tt_t_chr_shirt_scientistC.jpg", // 97
  "phase_4/maps/tt_t_chr_shirt_scientistA.jpg", // 98
  "phase_4/maps/tt_t_chr_shirt_scientistB.jpg", // 99

  // Silly Story Shirts
  "phase_4/maps/tt_t_chr_avt_shirt_mailbox.jpg", // 100 Mailbox Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_trashcan.jpg", // 101 Trash Can Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_loonyLabs.jpg", // 102 Loony Labs Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_hydrant.jpg", // 103 Hydrant Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_whistle.jpg", // 104 Sillymeter Whistle Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_cogbuster.jpg", // 105 Silly Cogbuster Shirt

  "phase_4/maps/tt_t_chr_avt_shirt_mostCogsDefeated01.jpg", // 106 Most Cogs Defeated Shirt
  "phase_4/maps/tt_t_chr_avt_shirt_victoryParty01.jpg", // 107 Victory Party Shirt 1
  "phase_4/maps/tt_t_chr_avt_shirt_victoryParty02.jpg", // 108 Victory Party Shirt 2
];

export const SLEEVES: ReadonlyArray<string> = [
  "phase_3/maps/desat_sleeve_1.jpg", // 0
  "phase_3/maps/desat_sleeve_2.jpg", // 1
  "phase_3/maps/desat_sleeve_3.jpg", // 2
  "phase_3/maps/desat_sleeve_4.jpg", // 3
  "phase_3/maps/desat_sleeve_5.jpg", // 4
  "phase_3/maps/desat_sleeve_6.jpg", // 5
  "phase_3/maps/desat_sleeve_7.jpg", // 6
  "phase_3/maps/desat_sleeve_8.jpg", // 7
  "phase_3/maps/desat_sleeve_9.jpg", // 8
  "phase_3/maps/desat_sleeve_10.jpg", // 9
  "phase_3/maps/desat_sleeve_15.jpg", // 10
  "phase_3/maps/desat_sleeve_16.jpg", // 11
  "phase_3/maps/desat_sleeve_19.jpg", // 12
  "phase_3/maps/desat_sleeve_20.jpg", // 13

  // Catalog exclusive shirt sleeves
  "phase_4/maps/female_sleeve1b.jpg", // 14 blue with 3 yellow stripes
  "phase_4/maps/female_sleeve2.jpg", // 15 pink and beige with flower
  "phase_4/maps/female_sleeve3.jpg", // 16 yellow hooded sweatshirt
  "phase_4/maps/male_sleeve1.jpg", // 17 blue stripes
  "phase_4/maps/male_sleeve2_palm.jpg", // 18 yellow with palm tree
  "phase_4/maps/male_sleeve3c.jpg", // 19 orange

  "phase_4/maps/shirt_Sleeve_ghost.jpg", // 20 ghost (Halloween)
  "phase_4/maps/shirt_Sleeve_pumkin.jpg", // 21 pumpkin (Halloween)

  "phase_4/maps/holidaySleeve1.jpg", // 22 (Winter Holiday)
  "phase_4/maps/holidaySleeve3.jpg", // 23 (Winter Holiday)

  // Catalog series 2
  "phase_4/maps/female_sleeve1b.jpg", // 24 Blue and gold wavy stripes
  "phase_4/maps/female_sleeve5New.jpg", // 25 Blue and pink with bow
  "phase_4/maps/male_sleeve4New.jpg", // 26 Lime green with stripe
  "phase_4/maps/sleeve6New.jpg", // 27 Purple with stars
  "phase_4/maps/SleeveMaleNew7.jpg", // 28 Red kimono/hockey shirt

  // Unused
  "phase_4/maps/female_sleeveNew6.jpg", // 29 Aqua kimono white stripe

  "phase_4/maps/Vday5Sleeve.jpg", // 30 (Valentines)
  "phase_4/maps/Vda6Sleeve.jpg", // 31 (Valentines)
  "phase_4/maps/Vday_shirt4sleeve.jpg", // 32 (Valentines)
  "phase_4/maps/Vday2cSleeve.jpg", // 33 (Valentines)

  // Catalog series 3
  "phase_4/maps/sleeveTieDye.jpg", // 34 Tie dye
  "phase_4/maps/male_sleeve1.jpg", // 35 Blue with blue and white stripe

  // St. Patrick's day
  "phase_4/maps/StPats_sleeve.jpg", // 36 (St. Pats) Four leaf clover
  "phase_4/maps/StPats_sleeve2.jpg", // 37 (St. Pats) Pot o gold

  // T-Shirt Contest sleeves
  "phase_4/maps/ContestfishingVestSleeve1.jpg", // 38 (T-Shirt Contest) fishing vest sleeve
  "phase_4/maps/ContestFishtankSleeve1.jpg", // 39 (T-Shirt Contest) fish bowl sleeve
  "phase_4/maps/ContestPawSleeve1.jpg", // 40 (T-Shirt Contest) paw print sleeve

  // Catalog Series 4
  "phase_4/maps/CowboySleeve1.jpg", // 41 (Western) cowboy shirt sleeve
  "phase_4/maps/CowboySleeve2.jpg", // 42 (Western) cowboy shirt sleeve
  "phase_4/maps/CowboySleeve3.jpg", // 43 (Western) cowboy shirt sleeve
  "phase_4/maps/CowboySleeve4.jpg", // 44 (Western) cowboy shirt sleeve
  "phase_4/maps/CowboySleeve5.jpg", // 45 (Western) cowboy shirt sleeve
  "phase_4/maps/CowboySleeve6.jpg", // 46 (Western) cowboy shirt sleeve

  // July 4th
  "phase_4/maps/4thJulySleeve1.jpg", // 47 (July 4th) flag shirt sleeve
  "phase_4/maps/4thJulySleeve2.jpg", // 48 (July 4th) fireworks shirt sleeve

  // Catlog series 7
  "phase_4/maps/shirt_sleeveCat7_01.jpg", // 49 Green shirt w/ yellow buttons sleeve
  "phase_4/maps/shirt_sleeveCat7_02.jpg", // 50 Purple shirt w/ big flower sleeve

  // T-Shirt Contest 2 sleeves
  "phase_4/maps/contest_backpack_sleeve.jpg", // 51 (T-Shirt Contest) Multicolor shirt 2/ backpack sleeve
  "phase_4/maps/Contest_leder_sleeve.jpg", // 52 (T-Shirt Contest) Lederhosen sleeve
  "phase_4/maps/contest_mellon_sleeve2.jpg", // 53 (T-Shirt Contest) Watermelon sleeve
  "phase_4/maps/contest_race_sleeve.jpg", // 54 (T-Shirt Contest) Race Shirt sleeve (UK winner)

  // Pajama sleeves
  "phase_4/maps/PJSleeveBlue.jpg", // 55 Blue Pajama sleeve
  "phase_4/maps/PJSleeveRed.jpg", // 56 Red Pajama sleeve
  "phase_4/maps/PJSleevePurple.jpg", // 57 Purple Pajama sleeve

  // 2009 Valentines Day Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_valentine1.jpg", // 58 Valentines Sleeves 1
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_valentine2.jpg", // 59 Valentines Sleeves 2

  // Special Award Clothing
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_desat4.jpg", // 60
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_fishing1.jpg", // 61
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_fishing2.jpg", // 62
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_gardening1.jpg", // 63
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_gardening2.jpg", // 64
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_party1.jpg", // 65
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_party2.jpg", // 66
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_racing1.jpg", // 67
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_racing2.jpg", // 68
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_summer1.jpg", // 69
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_summer2.jpg", // 70

  "phase_4/maps/tt_t_chr_avt_shirtSleeve_golf1.jpg", // 71
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_golf2.jpg", // 72
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_halloween1.jpg", // 73
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_halloween2.jpg", // 74
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_marathon1.jpg", // 75
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_saveBuilding1.jpg", // 76
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_saveBuilding2.jpg", // 77
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_toonTask1.jpg", // 78
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_toonTask2.jpg", // 79
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_trolley1.jpg", // 80
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_trolley2.jpg", // 81
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_winter1.jpg", // 82
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_halloween3.jpg", // 83
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_halloween4.jpg", // 84

  // 2010 Valentines Day Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_valentine3.jpg", // 85 Valentines Sleeves 1

  // Scientist Sleeves
  "phase_4/maps/tt_t_chr_shirtSleeve_scientist.jpg", // 86 Toon sceintist

  // Silly Story Shirt Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_mailbox.jpg", // 87 Mailbox Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_trashcan.jpg", // 88 Trash Can Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_loonyLabs.jpg", // 89 Loony Labs Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_hydrant.jpg", // 90 Hydrant Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_whistle.jpg", // 91 Sillymeter Whistle Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_cogbuster.jpg", // 92 Silly Cogbuster Sleeves

  "phase_4/maps/tt_t_chr_avt_shirtSleeve_mostCogsDefeated01.jpg", // 93 Most Cogs Defeated Sleeves
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_victoryParty01.jpg", // 94 Victory Party Sleeves 1
  "phase_4/maps/tt_t_chr_avt_shirtSleeve_victoryParty02.jpg", // 95 Victory Party Sleeves 2
];

export const BOY_SHORTS: string[] = [
  "phase_3/maps/desat_shorts_1.jpg", // plain w/ pockets
  "phase_3/maps/desat_shorts_2.jpg", // belt
  "phase_3/maps/desat_shorts_4.jpg", // cargo
  "phase_3/maps/desat_shorts_6.jpg", // hawaiian
  "phase_3/maps/desat_shorts_7.jpg", // special, side stripes
  "phase_3/maps/desat_shorts_8.jpg", // soccer shorts
  "phase_3/maps/desat_shorts_9.jpg", // special, flames side stripes
  "phase_3/maps/desat_shorts_10.jpg", // denim (2 darker colors)

  // Valentines
  "phase_4/maps/VdayShorts2.jpg", // 8 valentines shorts

  // Catalog series 3 exclusive
  "phase_4/maps/shorts4.jpg", // 9 Orange with blue side stripes
  "phase_4/maps/shorts1.jpg", // 10 Blue with gold stripes on cuff

  // St. Pats
  "phase_4/maps/shorts5.jpg", // 11 Leprechaun shorts

  // Catalog series 4 exclusive
  "phase_4/maps/CowboyShorts1.jpg", // 12 Cowboy Shorts 1
  "phase_4/maps/CowboyShorts2.jpg", // 13 Cowboy Shorts 2
  // July 4th
  "phase_4/maps/4thJulyShorts1.jpg", // 14 July 4th Shorts

  // Catalog series 7
  "phase_4/maps/shortsCat7_01.jpg", // 15 Green stripes

  // Pajama Shorts
  "phase_4/maps/Blue_shorts_1.jpg", // 16 Blue Pajama shorts
  "phase_4/maps/Red_shorts_1.jpg", // 17 Red Pajama shorts
  "phase_4/maps/Purple_shorts_1.jpg", // 18 Purple Pajama shorts

  // Winter Holiday Shorts
  "phase_4/maps/tt_t_chr_avt_shorts_winter1.jpg", // 19 Winter Holiday Shorts Style 1
  "phase_4/maps/tt_t_chr_avt_shorts_winter2.jpg", // 20 Winter Holiday Shorts Style 2
  "phase_4/maps/tt_t_chr_avt_shorts_winter3.jpg", // 21 Winter Holiday Shorts Style 3
  "phase_4/maps/tt_t_chr_avt_shorts_winter4.jpg", // 22 Winter Holiday Shorts Style 4

  // 2009 Valentines Day Shorts
  "phase_4/maps/tt_t_chr_avt_shorts_valentine1.jpg", // 23 Valentines Shorts 1
  "phase_4/maps/tt_t_chr_avt_shorts_valentine2.jpg", // 24 Valentines Shorts 2

  // Special award Clothes
  "phase_4/maps/tt_t_chr_avt_shorts_fishing1.jpg", // 25
  "phase_4/maps/tt_t_chr_avt_shorts_gardening1.jpg", // 26
  "phase_4/maps/tt_t_chr_avt_shorts_party1.jpg", // 27
  "phase_4/maps/tt_t_chr_avt_shorts_racing1.jpg", // 28
  "phase_4/maps/tt_t_chr_avt_shorts_summer1.jpg", // 29

  "phase_4/maps/tt_t_chr_avt_shorts_golf1.jpg", // 30
  "phase_4/maps/tt_t_chr_avt_shorts_halloween1.jpg", // 31
  "phase_4/maps/tt_t_chr_avt_shorts_halloween2.jpg", // 32
  "phase_4/maps/tt_t_chr_avt_shorts_saveBuilding1.jpg", // 33
  "phase_4/maps/tt_t_chr_avt_shorts_trolley1.jpg", // 34
  "phase_4/maps/tt_t_chr_avt_shorts_halloween4.jpg", // 35
  "phase_4/maps/tt_t_chr_avt_shorts_halloween3.jpg", // 36

  "phase_4/maps/tt_t_chr_shorts_scientistA.jpg", // 37
  "phase_4/maps/tt_t_chr_shorts_scientistB.jpg", // 38
  "phase_4/maps/tt_t_chr_shorts_scientistC.jpg", // 39

  "phase_4/maps/tt_t_chr_avt_shorts_cogbuster.jpg", // 40 Silly Cogbuster Shorts
];

export enum BottomsType {
  Shorts,
  Skirt,
}

export const GIRL_BOTTOMS: [string, BottomsType][] = [
  ["phase_3/maps/desat_skirt_1.jpg", BottomsType.Skirt], // 0 solid
  ["phase_3/maps/desat_skirt_2.jpg", BottomsType.Skirt], // 1 special, polka dots
  ["phase_3/maps/desat_skirt_3.jpg", BottomsType.Skirt], // 2 vertical stripes
  ["phase_3/maps/desat_skirt_4.jpg", BottomsType.Skirt], // 3 horizontal stripe
  ["phase_3/maps/desat_skirt_5.jpg", BottomsType.Skirt], // 4 flower print
  ["phase_3/maps/desat_shorts_1.jpg", BottomsType.Shorts], // 5 plain w/ pockets
  ["phase_3/maps/desat_shorts_5.jpg", BottomsType.Shorts], // 6 flower
  ["phase_3/maps/desat_skirt_6.jpg", BottomsType.Skirt], // 7 special, 2 pockets
  ["phase_3/maps/desat_skirt_7.jpg", BottomsType.Skirt], // 8 denim (2 darker colors)
  ["phase_3/maps/desat_shorts_10.jpg", BottomsType.Shorts], // 9 denim (2 darker colors)

  // Catalog Series 1 exclusive
  ["phase_4/maps/female_skirt1.jpg", BottomsType.Skirt], // 10 blue with tan border and button
  ["phase_4/maps/female_skirt2.jpg", BottomsType.Skirt], // 11 purple with pink border and ribbon
  ["phase_4/maps/female_skirt3.jpg", BottomsType.Skirt], // 12 teal with yellow border and star

  // Valentines
  ["phase_4/maps/VdaySkirt1.jpg", BottomsType.Skirt], // 13 valentines skirts

  // Catalog Series 3 exclusive
  ["phase_4/maps/skirtNew5.jpg", BottomsType.Skirt], // 14 rainbow skirt

  ["phase_4/maps/shorts5.jpg", BottomsType.Shorts], // 15 leprechaun shorts
  // St. Pats

  // Catalog Series 4 exclusive
  ["phase_4/maps/CowboySkirt1.jpg", BottomsType.Skirt], // 16 cowboy skirt 1
  ["phase_4/maps/CowboySkirt2.jpg", BottomsType.Skirt], // 17 cowboy skirt 2

  // July 4th Skirt
  ["phase_4/maps/4thJulySkirt1.jpg", BottomsType.Skirt], // 18 july 4th skirt 1

  // Catalog series 7
  ["phase_4/maps/skirtCat7_01.jpg", BottomsType.Skirt], // 19 blue with flower

  // Pajama Shorts
  ["phase_4/maps/Blue_shorts_1.jpg", BottomsType.Shorts], // 20 Blue Pajama shorts
  ["phase_4/maps/Red_shorts_1.jpg", BottomsType.Shorts], // 21 Red Pajama shorts
  ["phase_4/maps/Purple_shorts_1.jpg", BottomsType.Shorts], // 22 Purple Pajama shorts

  // Winter Holiday Skirts
  ["phase_4/maps/tt_t_chr_avt_skirt_winter1.jpg", BottomsType.Skirt], // 23 Winter Holiday Skirt Style 1
  ["phase_4/maps/tt_t_chr_avt_skirt_winter2.jpg", BottomsType.Skirt], // 24 Winter Holiday Skirt Style 2
  ["phase_4/maps/tt_t_chr_avt_skirt_winter3.jpg", BottomsType.Skirt], // 25 Winter Holiday Skirt Style 3
  ["phase_4/maps/tt_t_chr_avt_skirt_winter4.jpg", BottomsType.Skirt], // 26 Winter Holiday Skirt Style 4

  // 2009 Valentines Day Skirts
  ["phase_4/maps/tt_t_chr_avt_skirt_valentine1.jpg", BottomsType.Skirt], // 27 Valentines Skirt 1
  ["phase_4/maps/tt_t_chr_avt_skirt_valentine2.jpg", BottomsType.Skirt], // 28 Valentines Skirt 2

  // Special award clothing
  ["phase_4/maps/tt_t_chr_avt_skirt_fishing1.jpg", BottomsType.Skirt], // 29
  ["phase_4/maps/tt_t_chr_avt_skirt_gardening1.jpg", BottomsType.Skirt], // 30
  ["phase_4/maps/tt_t_chr_avt_skirt_party1.jpg", BottomsType.Skirt], // 31
  ["phase_4/maps/tt_t_chr_avt_skirt_racing1.jpg", BottomsType.Skirt], // 32
  ["phase_4/maps/tt_t_chr_avt_skirt_summer1.jpg", BottomsType.Skirt], // 33

  ["phase_4/maps/tt_t_chr_avt_skirt_golf1.jpg", BottomsType.Skirt], // 34
  ["phase_4/maps/tt_t_chr_avt_skirt_halloween1.jpg", BottomsType.Skirt], // 35
  ["phase_4/maps/tt_t_chr_avt_skirt_halloween2.jpg", BottomsType.Skirt], // 36
  ["phase_4/maps/tt_t_chr_avt_skirt_saveBuilding1.jpg", BottomsType.Skirt], // 37
  ["phase_4/maps/tt_t_chr_avt_skirt_trolley1.jpg", BottomsType.Skirt], // 38
  ["phase_4/maps/tt_t_chr_avt_skirt_halloween3.jpg", BottomsType.Skirt], // 39
  ["phase_4/maps/tt_t_chr_avt_skirt_halloween4.jpg", BottomsType.Skirt], // 40

  ["phase_4/maps/tt_t_chr_shorts_scientistA.jpg", BottomsType.Shorts], // 41
  ["phase_4/maps/tt_t_chr_shorts_scientistB.jpg", BottomsType.Shorts], // 42
  ["phase_4/maps/tt_t_chr_shorts_scientistC.jpg", BottomsType.Shorts], // 43

  ["phase_4/maps/tt_t_chr_avt_shorts_cogbuster.jpg", BottomsType.Shorts], // 44 Silly Cogbuster Shorts
];

export const HEAD_MODEL_PREFIXES: Record<string, string> = {
  // Dogs have separate models for each head type
  dls: "/models/char/tt_a_chr_dgm_shorts_head_",
  dss: "/models/char/tt_a_chr_dgm_skirt_head_",
  dsl: "/models/char/tt_a_chr_dgs_shorts_head_",
  dll: "/models/char/tt_a_chr_dgl_shorts_head_",
  [ToonSpecies.Cat]: "/models/char/cat-heads-",
  [ToonSpecies.Horse]: "/models/char/horse-heads-",
  [ToonSpecies.Mouse]: "/models/char/mouse-heads-",
  [ToonSpecies.Rabbit]: "/models/char/rabbit-heads-",
  [ToonSpecies.Duck]: "/models/char/duck-heads-",
  [ToonSpecies.Monkey]: "/models/char/monkey-heads-",
  [ToonSpecies.Bear]: "/models/char/bear-heads-",
  [ToonSpecies.Pig]: "/models/char/pig-heads-",
};

export const DOG_MUZZLE_MODELS: Record<string, string> = {
  dls: "/models/char/dogMM_Shorts-headMuzzles-",
  dss: "/models/char/dogMM_Skirt-headMuzzles-",
  dsl: "/models/char/dogSS_Shorts-headMuzzles-",
  dll: "/models/char/dogLL_Shorts-headMuzzles-",
};

export const EYELASH_MODELS: Record<ToonSpecies, string> = {
  [ToonSpecies.Dog]: "/models/char/dog-lashes",
  [ToonSpecies.Cat]: "/models/char/cat-lashes",
  [ToonSpecies.Horse]: "/models/char/horse-lashes",
  [ToonSpecies.Mouse]: "/models/char/mouse-lashes",
  [ToonSpecies.Rabbit]: "/models/char/rabbit-lashes",
  [ToonSpecies.Duck]: "/models/char/duck-lashes",
  [ToonSpecies.Monkey]: "/models/char/monkey-lashes",
  [ToonSpecies.Bear]: "/models/char/bear-lashes",
  [ToonSpecies.Pig]: "/models/char/pig-lashes",
};

export const LEG_MODEL_PREFIXES: Record<string, string> = {
  s: "/models/char/tt_a_chr_dgs_shorts_legs_",
  m: "/models/char/tt_a_chr_dgm_shorts_legs_",
  l: "/models/char/tt_a_chr_dgl_shorts_legs_",
};

export const TORSO_MODEL_PREFIXES: Record<string, string> = {
  s: "/models/char/dogSS_Naked-torso-",
  m: "/models/char/dogMM_Naked-torso-",
  l: "/models/char/dogLL_Naked-torso-",
  ss: "/models/char/tt_a_chr_dgs_shorts_torso_",
  ms: "/models/char/tt_a_chr_dgm_shorts_torso_",
  ls: "/models/char/tt_a_chr_dgl_shorts_torso_",
  sd: "/models/char/tt_a_chr_dgs_skirt_torso_",
  md: "/models/char/tt_a_chr_dgm_skirt_torso_",
  ld: "/models/char/tt_a_chr_dgl_skirt_torso_",
};

export const ALL_ANIMATIONS: Record<string, Record<string, string>> = {
  // Create-a-toon
  phase_3: {
    neutral: "neutral",
    run: "run",
  },

  // Tutorial
  "phase_3.5": {
    walk: "walk",
    teleport: "teleport",
    book: "book",
    jump: "jump",
    "running-jump": "running-jump",
    "jump-squat": "jump-zstart",
    "jump-idle": "jump-zhang",
    "jump-land": "jump-zend",
    "running-jump-squat": "leap_zstart",
    "running-jump-idle": "leap_zhang",
    "running-jump-land": "leap_zend",

    // Squirt and drop
    pushbutton: "press-button",

    // Throw
    throw: "pie-throw",
    victory: "victory-dance",
    "sidestep-left": "sidestep-left",

    // React
    conked: "conked",
    cringe: "cringe",

    // Emotes that are available to brand-new toons
    wave: "wave",
    shrug: "shrug",
    angry: "angry",

    // Special Animations
    // tutorial
    // WARNING: these channels only exist for Flippy!!! (dna: dls, m, m)
    "tutorial-neutral": "tutorial-neutral",
    "left-point": "left-point",
    "right-point": "right-point",
    "right-point-start": "right-point-start",
    "give-props": "give-props",
    "give-props-start": "give-props-start",
    "right-hand": "right-hand",
    "right-hand-start": "right-hand-start",
    duck: "duck",
    "sidestep-right": "jump-back-right",

    // Toon HQ
    // WARNING: this cycle only exists for dogMM!!!
    periscope: "periscope",
  },

  // Minigame
  phase_4: {
    sit: "sit",
    "sit-start": "intoSit",
    swim: "swim",
    "tug-o-war": "tug-o-war",
    "sad-walk": "losewalk",
    "sad-neutral": "sad-neutral",
    up: "up",
    down: "down",
    left: "left",
    right: "right",

    // Emotes (that must be purchased)
    applause: "applause",
    confused: "confused",
    bow: "bow",
    curtsy: "curtsy",
    bored: "bored",
    think: "think",

    // For use in battle
    battlecast: "fish",

    cast: "cast",
    castlong: "castlong",
    "fish-end": "fishEND",
    "fish-neutral": "fishneutral",
    "fish-again": "fishAGAIN",
    reel: "reel",
    "reel-H": "reelH",
    "reel-neutral": "reelneutral",
    pole: "pole",
    "pole-neutral": "poleneutral",

    "slip-forward": "slip-forward",
    "slip-backward": "slip-backward",

    // Catching game
    "catch-neutral": "gameneutral",
    "catch-run": "gamerun",
    "catch-eatneutral": "eat_neutral",
    "catch-eatnrun": "eatnrun",
    "catch-intro-throw": "gameThrow",

    // Swing game
    swing: "swing",

    // Pet cycles
    "pet-start": "petin",
    "pet-loop": "petloop",
    "pet-end": "petend",

    // Toon Hall
    scientistJealous: "scientistJealous",
    scientistEmcee: "scientistEmcee",
    scientistWork: "scientistWork",
    scientistGame: "scientistGame",
  },

  // Battle
  phase_5: {
    "water-gun": "water-gun",
    "hold-bottle": "hold-bottle",
    firehose: "firehose",
    spit: "spit",

    // Heal
    tickle: "tickle",
    smooch: "smooch",
    "happy-dance": "happy-dance",
    "sprinkle-dust": "sprinkle-dust",
    juggle: "juggle",
    climb: "climb",

    // Sound
    sound: "shout",

    // Trap
    toss: "toss",

    // Lure
    "hold-magnet": "hold-magnet",
    hypnotize: "hypnotize",

    // React
    struggle: "struggle",
    lose: "lose",
    melt: "melt",
  },

  // Estate
  "phase_5.5": {
    takePhone: "takePhone",
    phoneNeutral: "phoneNeutral",
    phoneBack: "phoneBack",
    bank: "jellybeanJar",
    callPet: "callPet",
    feedPet: "feedPet",
    "start-dig": "into_dig",
    "loop-dig": "loop_dig",
    water: "water",
  },

  // Estate
  phase_6: {
    "headdown-putt": "headdown-putt",
    "into-putt": "into-putt",
    "loop-putt": "loop-putt",
    "rotateL-putt": "rotateL-putt",
    "rotateR-putt": "rotateR-putt",
    "swing-putt": "swing-putt",
    "look-putt": "look-putt",
    "lookloop-putt": "lookloop-putt",
    "bad-putt": "bad-putt",
    "badloop-putt": "badloop-putt",
    "good-putt": "good-putt",
  },

  // Sellbot HQ
  phase_9: {
    push: "push",
  },

  // Cashbot HQ
  phase_10: {
    leverReach: "leverReach",
    leverPull: "leverPull",
    leverNeutral: "leverNeutral",
  },
};

export const LEG_HEIGHTS: Record<string, number> = {
  s: 1.5,
  m: 2.0,
  l: 2.75,
};

export const TORSO_HEIGHTS: Record<string, number> = {
  s: 1.5,
  m: 1.75,
  l: 2.25,
  ss: 1.5,
  ms: 1.75,
  ls: 2.25,
  sd: 1.5,
  md: 1.75,
  ld: 2.25,
};

export const HEAD_HEIGHTS: Record<string, number> = {
  dls: 0.75,
  dss: 0.5,
  dsl: 0.5,
  dll: 0.75,

  cls: 0.75,
  css: 0.5,
  csl: 0.5,
  cll: 0.75,

  hls: 0.75,
  hss: 0.5,
  hsl: 0.5,
  hll: 0.75,

  mls: 0.75,
  mss: 0.5,

  rls: 0.75,
  rss: 0.5,
  rsl: 0.5,
  rll: 0.75,

  fls: 0.75,
  fss: 0.5,
  fsl: 0.5,
  fll: 0.75,

  pls: 0.75,
  pss: 0.5,
  psl: 0.5,
  pll: 0.75,

  bls: 0.75,
  bss: 0.5,
  bsl: 0.5,
  bll: 0.75,

  sls: 0.75,
  sss: 0.5,
  ssl: 0.5,
  sll: 0.75,
};
