#!/usr/bin/env npx tsx
// Generate zone map from DNA files
// Usage: npx tsx src/Toontown/tools/cli-zone-map.ts [data_path]
// Example: npx tsx src/Toontown/tools/cli-zone-map.ts Toontown

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { DOMParser as XmldomParser } from "@xmldom/xmldom";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { type DNANode, parseDNA } from "../dna";
import { InteriorZoneType } from "../Globals";

const ZONE_TO_TITLES: Record<number, string> = {
  1506: "Gag Shop",
  1507: "Toon Headquarters",
  1508: "Clothing Shop",
  1510: "",
  1602: "Used Life Preservers",
  1604: "Wet Suit Dry Cleaners",
  1606: "Hook's Clock Repair",
  1608: "Luff 'N Stuff",
  1609: "Every Little Bait",
  1612: "Dime & Quarterdeck Bank",
  1613: "Squid Pro Quo, Attorneys at Law",
  1614: "Trim the Nail Boutique",
  1615: "Yacht's All, Folks!",
  1616: "Blackbeard's Beauty Parlor",
  1617: "Out to See Optics",
  1619: "Disembark! Tree Surgeons",
  1620: "From Fore to Aft",
  1621: "Poop Deck Gym",
  1622: "Bait and Switches Electrical Shop",
  1624: "Soles Repaired While U Wait",
  1626: "Salmon Chanted Evening Formal Wear",
  1627: "Billy Budd's Big Bargain Binnacle Barn",
  1628: "Piano Tuna",
  1629: "",
  1701: "Buoys and Gulls Nursery School",
  1703: "Wok the Plank Chinese Food",
  1705: "Sails for Sale",
  1706: "Peanut Butter and Jellyfish",
  1707: "Gifts With a Porpoise",
  1709: "Windjammers and Jellies",
  1710: "Barnacle Bargains",
  1711: "Deep Sea Diner",
  1712: "Able-Bodied Gym",
  1713: "Art's Smart Chart Mart",
  1714: "Reel 'Em Inn",
  1716: "Mermaid Swimwear",
  1717: "Be More Pacific Ocean Notions",
  1718: "Run Aground Taxi Service",
  1719: "Duck's Back Water Company",
  1720: "The Reel Deal",
  1721: "All For Nautical",
  1723: "Squid's Seaweed",
  1724: "That's  a Moray!",
  1725: "Ahab's Prefab Sea Crab Center",
  1726: "Root Beer Afloats",
  1727: "This Oar That",
  1728: "Good Luck Horseshoe Crabs",
  1729: "",
  1802: "Nautical But Nice",
  1804: "Mussel Beach Gymnasium",
  1805: "Tackle Box Lunches",
  1806: "Cap Size Hat Store",
  1807: "Keel Deals",
  1808: "Knots So Fast",
  1809: "Rusty Buckets",
  1810: "Anchor Management",
  1811: "What's Canoe With You?",
  1813: "Pier Pressure Plumbing",
  1814: "The Yo Ho Stop and Go",
  1815: "What's Up, Dock?",
  1818: "Seven Seas Cafe",
  1819: "Docker's Diner",
  1820: "Hook, Line, and Sinker Prank Shop",
  1821: "King Neptoon's Cannery",
  1823: "The Clam Bake Diner",
  1824: "Dog Paddles",
  1825: "Wholly Mackerel! Fish Market",
  1826: "Claggart's Clever Clovis Closet",
  1828: "Alice's Ballast Palace",
  1829: "Seagull Statue Store",
  1830: "Lost and Flounder",
  1831: "Kelp Around the House",
  1832: "Melville's Massive Mizzenmast Mart",
  1833: "This Transom Man Custom Tailored Suits",
  1834: "Rudderly Ridiculous!",
  1835: "",
  2513: "Toon Hall",
  2514: "Toontown Bank",
  2516: "Toontown School House",
  2518: "Toontown Library",
  2519: "Gag Shop",
  2520: "Toon HQ",
  2521: "Clothing Shop",
  2522: "Pet Shop",
  2601: "All Smiles Tooth Repair",
  2602: "",
  2603: "One-Liner Miners",
  2604: "Hogwash & Dry",
  2605: "Toontown Sign Factory",
  2606: "",
  2607: "Jumping Beans",
  2610: "Dr. Tom Foolery",
  2611: "",
  2616: "Weird Beard's Disguise Shop",
  2617: "Silly Stunts",
  2618: "All That Razz",
  2621: "Paper Airplanes",
  2624: "Happy Hooligans",
  2625: "House of Bad Pies",
  2626: "Jesse's Joke Repair",
  2629: "The Laughin' Place",
  2632: "Clown Class",
  2633: "Tee-Hee Tea Shop",
  2638: "Toontown Playhouse",
  2639: "Monkey Tricks",
  2643: "Canned Bottles",
  2644: "Impractical Jokes",
  2649: "All Fun and Games Shop",
  2652: "",
  2653: "",
  2654: "Laughing Lessons",
  2655: "Funny Money Savings & Loan",
  2656: "Used Clown Cars",
  2657: "Frank's Pranks",
  2659: "Joy Buzzers to the World",
  2660: "Tickle Machines",
  2661: "Daffy Taffy",
  2662: "Dr. I.M. Euphoric",
  2663: "Toontown Cinerama",
  2664: "The Merry Mimes",
  2665: "Mary's Go Around Travel Company",
  2666: "Laughing Gas Station",
  2667: "Happy Times",
  2669: "Muldoon's Maroon Balloons",
  2670: "Soup Forks",
  2671: "",
  2701: "",
  2704: "Movie Multiplex",
  2705: "Wiseacre's Noisemakers",
  2708: "Blue Glue",
  2711: "Toontown Post Office",
  2712: "Chortle Cafe",
  2713: "Laughter Hours Cafe",
  2714: "Kooky CinePlex",
  2716: "Soup and Crack Ups",
  2717: "Bottled Cans",
  2720: "Crack Up Auto Repair",
  2725: "",
  2727: "Seltzer Bottles and Cans",
  2728: "Vanishing Cream",
  2729: "14 Karat Goldfish",
  2730: "News for the Amused",
  2731: "",
  2732: "Spaghetti and Goofballs",
  2733: "Cast Iron Kites",
  2734: "Suction Cups and Saucers",
  2735: "The Kaboomery",
  2739: "Sidesplitter's Mending",
  2740: "Used Firecrackers",
  2741: "",
  2742: "",
  2743: "Ragtime Dry Cleaners",
  2744: "",
  2747: "Visible Ink",
  2748: "Jest for Laughs",
  2801: "Sofa Whoopee Cushions",
  2802: "Inflatable Wrecking Balls",
  2803: "The Karnival Kid",
  2804: "Dr. Pulyurleg, Chiropractor",
  2805: "",
  2809: "The Punch Line Gym",
  2814: "Toontown Theatre",
  2818: "The Flying Pie",
  2821: "",
  2822: "Rubber Chicken Sandwiches",
  2823: "Sundae Funnies Ice Cream",
  2824: "Punchline Movie Palace",
  2829: "Phony Baloney",
  2830: "Zippy's Zingers",
  2831: "Professor Wiggle's House of Giggles",
  2832: "",
  2833: "",
  2834: "Funny Bone Emergency Room",
  2836: "",
  2837: "Hardy Harr Seminars",
  2839: "Barely Palatable Pasta",
  2841: "",
  3507: "Gag Shop",
  3508: "Toon HQ",
  3509: "Clothing Shop",
  3511: "",
  3601: "Northern Lights Electric Company",
  3602: "Nor'easter Bonnets",
  3605: "",
  3607: "The Blizzard Wizard",
  3608: "Nothing to Luge",
  3610: "Mike's Massive Mukluk Mart",
  3611: "Mr. Cow's Snow Plows",
  3612: "Igloo Design",
  3613: "Ice Cycle Bikes",
  3614: "Snowflakes Cereal Company",
  3615: "Fried Baked Alaskas",
  3617: "Cold Air Balloon Rides",
  3618: "Snow Big Deal! Crisis Management",
  3620: "Skiing Clinic",
  3621: "The Melting Ice Cream Bar",
  3622: "",
  3623: "The Mostly Toasty Bread Company",
  3624: "Subzero Sandwich Shop",
  3625: "Auntie Freeze's Radiator Supply",
  3627: "St. Bernard Kennel Club",
  3629: "Pea Soup Cafe",
  3630: "Icy London, Icy France Travel Agency",
  3634: "Easy Chair Lifts",
  3635: "Used Firewood",
  3636: "Affordable Goosebumps",
  3637: "Kate's Skates",
  3638: "Toboggan or Not Toboggan",
  3641: "Fred's Red Sled Beds",
  3642: "Eye of the Storm Optics",
  3643: "Snowball Hall",
  3644: "Melted Ice Cubes",
  3647: "The Sanguine Penguin Tuxedo Shop",
  3648: "Instant Ice",
  3649: "Hambrrrgers",
  3650: "Antarctic Antiques",
  3651: "Frosty Freddy's Frozen Frankfurters",
  3653: "Ice House Jewelry",
  3654: "",
  3702: "Winter Storage",
  3703: "",
  3705: "Icicles Built for Two",
  3706: "Shiverin' Shakes Malt Shop",
  3707: "Snowplace Like Home",
  3708: "Pluto's Place",
  3710: "Dropping Degrees Diner",
  3711: "",
  3712: "Go With the Floe",
  3713: "Chattering Teeth, Subzero Dentist",
  3715: "Aunt Arctic's Soup Shop",
  3716: "Road Salt and Pepper",
  3717: "Juneau What I Mean?",
  3718: "Designer Inner Tubes",
  3719: "Ice Cube on a Stick",
  3721: "Noggin's Toboggan Bargains",
  3722: "Snow Bunny Ski Shop",
  3723: "Shakey's Snow Globes",
  3724: "The Chattering Chronicle",
  3725: "You Sleigh Me",
  3726: "Solar Powered Blankets",
  3728: "Lowbrow Snowplows",
  3729: "",
  3730: "Snowmen Bought & Sold",
  3731: "Portable Fireplaces",
  3732: "The Frozen Nose",
  3734: "Icy Fine, Do You? Optometry",
  3735: "Polar Ice Caps",
  3736: "Diced Ice at a Nice Price",
  3737: "Downhill Diner",
  3738: "Heat-Get It While It's Hot",
  3739: "",
  3801: "Toon HQ",
  3806: "Alpine Chow Line",
  3807: "Used Groundhog Shadows",
  3808: "The Sweater Lodge",
  3809: "Ice Saw It Too",
  3810: "A Better Built Quilt",
  3811: "Your Snow Angel",
  3812: "Mittens for Kittens",
  3813: "Snowshoes You Can't Refuse",
  3814: "Malt in Your Mouth Soda Fountain",
  3815: "The Toupee Chalet",
  3816: "Just So Mistletoe",
  3817: "Winter Wonderland Walking Club",
  3818: "The Shovel Hovel",
  3819: "Clean Sweep Chimney Service",
  3820: "Snow Whitening",
  3821: "Hibernation Vacations",
  3823: "Precipitation Foundation",
  3824: "Open Fire Chestnut Roasting",
  3825: "Cool Cat Hats",
  3826: "Oh My Galoshes!",
  3827: "Choral Wreaths",
  3828: "Snowman's Land",
  3829: "Pinecone Zone",
  3830: "Wait and See Goggle Defogging",
  4503: "Gag Shop",
  4504: "Toon Headquarters",
  4506: "Clothing Shop",
  4508: "",
  4603: "Tom-Tom's Drums",
  4604: "In Four-Four Time",
  4605: "Fifi's Fiddles",
  4606: "Casa De Castanets",
  4607: "Catchy Toon Apparel",
  4609: "Do, Rae, Me Piano Keys",
  4610: "Please Refrain",
  4611: "Tuning Forks and Spoons",
  4612: "Dr. Fret's Dentistry",
  4614: "Shave and a Haircut for a Song",
  4615: "Piccolo's Pizza",
  4617: "Happy Mandolins",
  4618: "Rests Rooms",
  4619: "More Scores",
  4622: "Chin Rest Pillows",
  4623: "Flats Sharpened",
  4625: "Tuba Toothpaste",
  4626: "Notations",
  4628: "Accidental Insurance",
  4629: "Riff's Paper Plates",
  4630: "Music Is Our Forte",
  4631: "Canto Help You",
  4632: "Dance Around the Clock Shop",
  4635: "Tenor Times",
  4637: "For Good Measure",
  4638: "Hard Rock Shop",
  4639: "Four Score Antiques",
  4641: "Blues News",
  4642: "Ragtime Dry Cleaners",
  4645: "Club 88",
  4646: "",
  4648: "Carry a Toon Movers",
  4649: "",
  4652: "Full Stop Shop",
  4653: "",
  4654: "Pitch Perfect Roofing",
  4655: "The Treble Chef's Cooking School",
  4656: "",
  4657: "Barbershop Quartet",
  4658: "Plummeting Pianos",
  4659: "",
  4701: "The Schmaltzy Waltz School of Dance",
  4702: "Timbre! Equipment for the Singing Lumberjack",
  4703: "I Can Handel It!",
  4704: "Tina's Concertina Concerts",
  4705: "Zither Here Nor There",
  4707: "Doppler's Sound Effects Studio",
  4709: "On Ballet! Climbing Supplies",
  4710: "Hurry Up, Slow Polka! School of Driving",
  4712: "C-Flat Tire Repair",
  4713: "B-Sharp Fine Menswear",
  4716: "Four-Part Harmonicas",
  4717: "Sonata Your Fault! Discount Auto Insurance",
  4718: "Chopin Blocks and Other Kitchen Supplies",
  4719: "Madrigal Motor Homes",
  4720: "Name That Toon",
  4722: "Overture Understudies",
  4723: "Haydn Go Seek Playground Supplies",
  4724: "White Noise for Girls and Boys",
  4725: "The Baritone Barber",
  4727: "Vocal Chords Braided",
  4728: "Sing Solo We Can't Hear You",
  4729: "Double Reed Bookstore",
  4730: "Lousy Lyrics",
  4731: "Toon Tunes",
  4732: "Etude Brute? Theatre Company",
  4733: "",
  4734: "",
  4735: "Accordions, If You Want In, Just Bellow!",
  4736: "Her and Hymn Wedding Planners",
  4737: "Harp Tarps",
  4738: "Canticle Your Fancy Gift Shop",
  4739: "",
  4801: "Marshall's Stacks",
  4803: "What a Mezzo! Maid Service",
  4804: "Mixolydian Scales",
  4807: "Relax the Bach",
  4809: "I Can't Understanza!",
  4812: "",
  4817: "The Ternary Pet Shop",
  4819: "Yuki's Ukeleles",
  4820: "",
  4821: "Anna's Cruises",
  4827: "Common Time Watches",
  4828: "Schumann's Shoes for Men",
  4829: "Pachelbel's Canonballs",
  4835: "Ursatz for Kool Katz",
  4836: "Reggae Regalia",
  4838: "Kazoology School of Music",
  4840: "Coda Pop Musical Beverages",
  4841: "Lyre, Lyre, Pants on Fire!",
  4842: "The Syncopation Corporation",
  4843: "",
  4844: "Con Moto Cycles",
  4845: "Ellie's Elegant Elegies",
  4848: "Lotsa Lute Savings & Loan",
  4849: "",
  4850: "The Borrowed Chord Pawn Shop",
  4852: "Flowery Flute Fleeces",
  4853: "Leo's Fenders",
  4854: "Wagner's Vocational Violin Videos",
  4855: "The Teli-Caster Network",
  4856: "",
  4862: "Quentin's Quintessential Quadrilles",
  4867: "Mr. Costello's Yellow Cellos",
  4868: "",
  4870: "Ziggy's Zoo of Zigeunermusik",
  4871: "Harry's House of Harmonious Humbuckers",
  4872: "Fast Freddie's Fretless Fingerboards",
  4873: "",
  5501: "Gag Shop",
  5502: "Toon HQ",
  5503: "Clothing Shop",
  5505: "",
  5601: "Eye of the Potato Optometry",
  5602: "Artie Choke's Neckties",
  5603: "Lettuce Alone",
  5604: "Cantaloupe Bridal Shop",
  5605: "Vege-tables and Chairs",
  5606: "Petals",
  5607: "Compost Office",
  5608: "Mom and Pop Corn",
  5609: "Berried Treasure",
  5610: "Black-eyed Susan's Boxing Lessons",
  5611: "Gopher's Gags",
  5613: "Crop Top Barbers",
  5615: "Bud's Bird Seed",
  5616: "Dew Drop Inn",
  5617: "Flutterby's Butterflies",
  5618: "Peas and Q's",
  5619: "Jack's Beanstalks",
  5620: "Rake It Inn",
  5621: "Grape Expectations",
  5622: "Petal Pusher Bicycles",
  5623: "Bubble Bird Baths",
  5624: "Mum's the Word",
  5625: "Leaf It Bees",
  5626: "Pine Needle Crafts",
  5627: "",
  5701: "From Start to Spinach",
  5702: "Jake's Rakes",
  5703: "Photo Cynthia's Camera Shop",
  5704: "Lisa Lemon Used Cars",
  5705: "Poison Oak Furniture",
  5706: "14 Carrot Jewelers",
  5707: "Musical Fruit",
  5708: "We'd Be Gone Travel Agency",
  5709: "Astroturf Mowers",
  5710: "Tuft Guy Gym",
  5711: "Garden Hosiery",
  5712: "Silly Statues",
  5713: "Trowels and Tribulations",
  5714: "Spring Rain Seltzer Bottles",
  5715: "Hayseed News",
  5716: "Take It or Leaf It Pawn Shop",
  5717: "The Squirting Flower",
  5718: "The Dandy Lion Exotic Pets",
  5719: "Trellis the Truth! Private Investigators",
  5720: "Vine and Dandy Menswear",
  5721: "Root 66 Diner",
  5725: "Barley, Hops, and Malt Shop",
  5726: "Bert's Dirt",
  5727: "Gopher Broke Savings & Loan",
  5728: "",
  5802: "Toon HQ",
  5804: "Just Vase It",
  5805: "Snail Mail",
  5809: "Fungi Clown School",
  5810: "Honeydew This",
  5811: "Lettuce Inn",
  5815: "Grass Roots",
  5817: "Apples and Oranges",
  5819: "Green Bean Jeans",
  5821: "Squash and Stretch Gym",
  5826: "Ant Farming Supplies",
  5827: "Dirt. Cheap.",
  5828: "Couch Potato Furniture",
  5830: "Spill the Beans",
  5833: "The Salad Bar",
  5835: "Flower Bed and Breakfast",
  5836: "April's Showers and Tubs",
  5837: "School of Vine Arts",
  9501: "Lullaby Library",
  9503: "The Snooze Bar",
  9504: "Gag Shop",
  9505: "Toon HQ",
  9506: "Clothing Shop",
  9508: "",
  9601: "Snuggle Inn",
  9602: "Forty Winks for the Price of Twenty",
  9604: "Ed's Red Bed Spreads",
  9605: "Cloud Nine Design",
  9607: "Big Mama's Bahama Pajamas",
  9608: "Cat Nip for Cat Naps",
  9609: "Deep Sleep for Cheap",
  9613: "Clock Cleaners",
  9616: "Lights Out Electric Co.",
  9617: "Crib Notes - Music to Sleep By",
  9619: "Relax to the Max",
  9620: "PJ's Taxi Service",
  9622: "Sleepy Time Pieces",
  9625: "Curl Up Beauty Parlor",
  9626: "Bed Time Stories",
  9627: "The Sleepy Teepee",
  9628: "Call It a Day Calendars",
  9629: "Silver Lining Jewelers",
  9630: "Rock to Sleep Quarry",
  9631: "Down Time Watch Repair",
  9633: "The Dreamland Screening Room",
  9634: "Mind Over Mattress",
  9636: "Insomniac Insurance",
  9639: "House of Hibernation",
  9640: "Nightstand Furniture Company",
  9642: "Sawing Wood Slumber Lumber",
  9643: "Shut-Eye Optometry",
  9644: "Pillow Fights Nightly",
  9645: "The All Tucked Inn",
  9647: "Make Your Bed! Hardware Store",
  9649: "Snore or Less",
  9650: "Crack of Dawn Repairs",
  9651: "For Richer or Snorer",
  9652: "",
  9703: "Fly By Night Travel Agency",
  9704: "Night Owl Pet Shop",
  9705: "Asleep At The Wheel Car Repair",
  9706: "Tooth Fairy Dentistry",
  9707: "Dawn's Yawn & Garden Center",
  9708: "Bed Of Roses Florist",
  9709: "Pipe Dream Plumbers",
  9710: "REM Optometry",
  9711: "Wake-Up Call Phone Company",
  9712: "Counting Sheep - So You Don't Have To!",
  9713: "Wynken, Blynken & Nod, Attorneys at Law",
  9714: "Dreamboat Marine Supply",
  9715: "First Security Blanket Bank",
  9716: "Wet Blanket Party Planners",
  9717: "Baker's Dozin' Doughnuts",
  9718: "Sandman's Sandwiches",
  9719: "Armadillo Pillow Company",
  9720: "Talking In Your Sleep Voice Training",
  9721: "Snug As A Bug Rug Dealer",
  9722: "Dream On Talent Agency",
  9725: "Cat's Pajamas",
  9727: "You Snooze, You Lose",
  9736: "Dream Jobs Employment Agency",
  9737: "Waltzing Matilda's Dance School",
  9738: "House of Zzzzzs",
  9740: "Hit The Sack Fencing School",
  9741: "Don't Let The Bed Bugs Bite Exterminators",
  9744: "Rip Van Winkle's Wrinkle Cream",
  9752: "Midnight Oil & Gas Company",
  9753: "Moonbeam's Ice Creams",
  9754: "Sleepless in the Saddle All Night Pony Rides",
  9755: "Bedknobs & Broomsticks Movie House",
  9756: "",
  9759: "Sleeping Beauty Parlor",
};

if (typeof DOMParser === "undefined") {
  (globalThis as any).DOMParser = XmldomParser;
}

const dataArg = process.argv[2] || "Toontown";
const DATA_PATH = path.join(__dirname, "../../../data", dataArg);

interface ManifestEntry {
  file: string;
  offset: number;
  length: number;
  compressed: boolean;
}

type Manifest = Record<string, ManifestEntry>;

function loadManifest(): Manifest {
  const manifestPath = path.join(DATA_PATH, "manifest.json");
  const manifestData = fs.readFileSync(manifestPath, "utf-8");
  return JSON.parse(manifestData);
}

function loadFile(manifest: Manifest, name: string): ArrayBufferSlice {
  const entry = manifest[name];
  if (!entry) throw new Error(`File not found: ${name}`);

  const multifilePath = path.join(DATA_PATH, entry.file);
  const fd = fs.openSync(multifilePath, "r");
  const buffer = Buffer.alloc(entry.length);
  fs.readSync(fd, buffer, 0, entry.length, entry.offset);
  fs.closeSync(fd);

  let data: ArrayBufferLike;
  if (entry.compressed) {
    const decompressed = zlib.inflateSync(buffer);
    data = decompressed.buffer.slice(
      decompressed.byteOffset,
      decompressed.byteOffset + decompressed.byteLength,
    );
  } else {
    data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  }
  return new ArrayBufferSlice(data);
}

function loadFileAsString(manifest: Manifest, name: string): string {
  const data = loadFile(manifest, name);
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(data.createTypedArray(Uint8Array));
}

// Map building_type to ZoneType
function getBuildingZoneType(
  buildingType: string | undefined,
): InteriorZoneType {
  switch (buildingType) {
    case "gagshop":
      return InteriorZoneType.GagShop;
    case "hq":
      return InteriorZoneType.ToonHQ;
    case "clotheshop":
      return InteriorZoneType.ClothingShop;
    case "petshop":
      return InteriorZoneType.PetShop;
    case "animbldg": // Animated building, still a regular toon interior
    case undefined:
      return InteriorZoneType.ToonInterior;
    default:
      console.warn(`Unknown building_type: "${buildingType}"`);
      return InteriorZoneType.ToonInterior;
  }
}

// Extract block ID from landmark building name (e.g., "tb8:..." -> 8)
function extractBlockId(name: string): number | null {
  const match = name.match(/^[a-z]{2}(\d+):/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

interface LandmarkInfo {
  blockId: number;
  buildingType: string | undefined;
  title: string;
  zoneType: InteriorZoneType;
}

// Recursively find all landmark_building nodes
function findLandmarkBuildings(nodes: DNANode[]): LandmarkInfo[] {
  const landmarks: LandmarkInfo[] = [];

  for (const node of nodes) {
    if (node.type === "landmark_building" || node.type === "anim_building") {
      const blockId = extractBlockId(node.name);
      if (blockId !== null) {
        landmarks.push({
          blockId,
          buildingType: node.buildingType,
          title: node.title,
          zoneType: getBuildingZoneType(node.buildingType),
        });
      }
    }

    if ("children" in node && node.children) {
      landmarks.push(...findLandmarkBuildings(node.children));
    }
  }

  return landmarks;
}

// DNA file naming conventions:
// - Safezone: {hood}_sz.dna (zone ID = hood ID, e.g., 1000)
// - Street: {hood}_{zone_id}.dna (e.g., donalds_dock_1100.dna)
interface DNAFileInfo {
  path: string;
  baseZoneId: number;
  isSafezone: boolean;
}

// Map DNA file paths to zone IDs
function getDNAFileZoneInfo(): DNAFileInfo[] {
  const files: DNAFileInfo[] = [];

  // Donald's Dock (1000)
  files.push({
    path: "phase_6/dna/donalds_dock_sz.dna",
    baseZoneId: 1000,
    isSafezone: true,
  });
  files.push({
    path: "phase_6/dna/donalds_dock_1100.dna",
    baseZoneId: 1100,
    isSafezone: false,
  });
  files.push({
    path: "phase_6/dna/donalds_dock_1200.dna",
    baseZoneId: 1200,
    isSafezone: false,
  });
  files.push({
    path: "phase_6/dna/donalds_dock_1300.dna",
    baseZoneId: 1300,
    isSafezone: false,
  });

  // Toontown Central (2000)
  files.push({
    path: "phase_4/dna/toontown_central_sz.dna",
    baseZoneId: 2000,
    isSafezone: true,
  });
  files.push({
    path: "phase_5/dna/toontown_central_2100.dna",
    baseZoneId: 2100,
    isSafezone: false,
  });
  files.push({
    path: "phase_5/dna/toontown_central_2200.dna",
    baseZoneId: 2200,
    isSafezone: false,
  });
  files.push({
    path: "phase_5/dna/toontown_central_2300.dna",
    baseZoneId: 2300,
    isSafezone: false,
  });

  // The Brrrgh (3000)
  files.push({
    path: "phase_8/dna/the_burrrgh_sz.dna",
    baseZoneId: 3000,
    isSafezone: true,
  });
  files.push({
    path: "phase_8/dna/the_burrrgh_3100.dna",
    baseZoneId: 3100,
    isSafezone: false,
  });
  files.push({
    path: "phase_8/dna/the_burrrgh_3200.dna",
    baseZoneId: 3200,
    isSafezone: false,
  });
  files.push({
    path: "phase_8/dna/the_burrrgh_3300.dna",
    baseZoneId: 3300,
    isSafezone: false,
  });

  // Minnie's Melodyland (4000)
  files.push({
    path: "phase_6/dna/minnies_melody_land_sz.dna",
    baseZoneId: 4000,
    isSafezone: true,
  });
  files.push({
    path: "phase_6/dna/minnies_melody_land_4100.dna",
    baseZoneId: 4100,
    isSafezone: false,
  });
  files.push({
    path: "phase_6/dna/minnies_melody_land_4200.dna",
    baseZoneId: 4200,
    isSafezone: false,
  });
  files.push({
    path: "phase_6/dna/minnies_melody_land_4300.dna",
    baseZoneId: 4300,
    isSafezone: false,
  });

  // Daisy Gardens (5000)
  files.push({
    path: "phase_8/dna/daisys_garden_sz.dna",
    baseZoneId: 5000,
    isSafezone: true,
  });
  files.push({
    path: "phase_8/dna/daisys_garden_5100.dna",
    baseZoneId: 5100,
    isSafezone: false,
  });
  files.push({
    path: "phase_8/dna/daisys_garden_5200.dna",
    baseZoneId: 5200,
    isSafezone: false,
  });
  files.push({
    path: "phase_8/dna/daisys_garden_5300.dna",
    baseZoneId: 5300,
    isSafezone: false,
  });

  // Donald's Dreamland (9000)
  files.push({
    path: "phase_8/dna/donalds_dreamland_sz.dna",
    baseZoneId: 9000,
    isSafezone: true,
  });
  files.push({
    path: "phase_8/dna/donalds_dreamland_9100.dna",
    baseZoneId: 9100,
    isSafezone: false,
  });
  files.push({
    path: "phase_8/dna/donalds_dreamland_9200.dna",
    baseZoneId: 9200,
    isSafezone: false,
  });

  return files;
}

function main() {
  console.log(`Using data path: ${DATA_PATH}\n`);
  const manifest = loadManifest();

  const dnaFiles = getDNAFileZoneInfo();
  const zoneMap: Map<number, [string, InteriorZoneType]> = new Map();

  for (const fileInfo of dnaFiles) {
    try {
      const content = loadFileAsString(manifest, fileInfo.path);
      const dnaFile = parseDNA(content);
      const landmarks = findLandmarkBuildings(dnaFile.root);

      console.log(
        `\n=== ${fileInfo.path} (base zone ${fileInfo.baseZoneId}) ===`,
      );

      for (const landmark of landmarks) {
        // Interior zone ID = base zone ID + 500 + block ID
        const interiorZoneId = fileInfo.baseZoneId + 500 + landmark.blockId;

        zoneMap.set(interiorZoneId, [landmark.title, landmark.zoneType]);

        const zoneTypeName = InteriorZoneType[landmark.zoneType];
        console.log(
          `  Block ${landmark.blockId} -> Zone ${interiorZoneId}: "${landmark.title}" (${zoneTypeName})`,
        );
      }
    } catch (e) {
      console.error(`Error processing ${fileInfo.path}:`, e);
    }
  }

  // Compare with existing ZONE_TO_TITLES
  console.log("\n\n=== Comparison with existing ZONE_TO_TITLES ===\n");

  const existingZones = new Set(Object.keys(ZONE_TO_TITLES).map(Number));
  const generatedZones = new Set(zoneMap.keys());

  // Find zones in existing but not in generated
  const missingFromGenerated: number[] = [];
  for (const zoneId of existingZones) {
    if (!generatedZones.has(zoneId)) {
      missingFromGenerated.push(zoneId);
    }
  }

  // Find zones in generated but not in existing
  const missingFromExisting: number[] = [];
  for (const zoneId of generatedZones) {
    if (!existingZones.has(zoneId)) {
      missingFromExisting.push(zoneId);
    }
  }

  // Find title discrepancies
  const titleDiscrepancies: Array<{
    zoneId: number;
    existing: string;
    generated: string;
  }> = [];
  for (const [zoneId, [generatedTitle]] of zoneMap) {
    const existingTitle = ZONE_TO_TITLES[zoneId];
    if (existingTitle !== undefined && existingTitle !== generatedTitle) {
      titleDiscrepancies.push({
        zoneId,
        existing: existingTitle,
        generated: generatedTitle,
      });
    }
  }

  if (missingFromGenerated.length > 0) {
    console.log("Zones in ZONE_TO_TITLES but NOT generated from DNA:");
    for (const zoneId of missingFromGenerated.sort((a, b) => a - b)) {
      console.log(`  ${zoneId}: "${ZONE_TO_TITLES[zoneId]}"`);
    }
    console.log();
  } else {
    console.log("All ZONE_TO_TITLES entries found in DNA files.\n");
  }

  if (missingFromExisting.length > 0) {
    console.log("Zones generated from DNA but NOT in ZONE_TO_TITLES:");
    for (const zoneId of missingFromExisting.sort((a, b) => a - b)) {
      const [title, zoneType] = zoneMap.get(zoneId)!;
      console.log(`  ${zoneId}: "${title}" (${InteriorZoneType[zoneType]})`);
    }
    console.log();
  } else {
    console.log("All generated zones exist in ZONE_TO_TITLES.\n");
  }

  if (titleDiscrepancies.length > 0) {
    console.log("Title discrepancies:");
    for (const { zoneId, existing, generated } of titleDiscrepancies.sort(
      (a, b) => a.zoneId - b.zoneId,
    )) {
      console.log(`  ${zoneId}:`);
      console.log(`    Existing:  "${existing}"`);
      console.log(`    Generated: "${generated}"`);
    }
    console.log();
  } else {
    console.log("No title discrepancies found.\n");
  }

  console.log(
    `Summary: ${existingZones.size} existing, ${generatedZones.size} generated, ` +
      `${missingFromGenerated.length} missing from generated, ` +
      `${missingFromExisting.length} missing from existing, ` +
      `${titleDiscrepancies.length} title discrepancies`,
  );

  // Output the TypeScript map, preferring manually curated titles from ZONE_TO_TITLES
  console.log("\n\n// Generated zone map");
  console.log("export const ZONE_DATA: Record<number, [string, ZoneType]> = {");

  const sortedEntries = [...zoneMap.entries()].sort((a, b) => a[0] - b[0]);
  for (const [zoneId, [dnaTitle, zoneType]] of sortedEntries) {
    // Prefer manually curated title, fall back to DNA title
    const title = ZONE_TO_TITLES[zoneId] ?? dnaTitle;
    const escapedTitle = title.replace(/"/g, '\\"');
    console.log(
      `  ${zoneId}: ["${escapedTitle}", ZoneType.${InteriorZoneType[zoneType]}],`,
    );
  }

  console.log("};");
}

main();
