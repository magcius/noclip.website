import { type ReadonlyVec3, type ReadonlyVec4, vec3, vec4 } from "gl-matrix";
import type { DNASceneBuilder, DNAStorage } from "../dna";
import {
  getBranchZone,
  getHoodId,
  HOOD_ID_DAISY_GARDENS,
  HOOD_ID_DONALDS_DOCK,
  HOOD_ID_DONALDS_DREAMLAND,
  HOOD_ID_GOOFY_SPEEDWAY,
  HOOD_ID_MINNIES_MELODYLAND,
  HOOD_ID_MY_ESTATE,
  HOOD_ID_THE_BRRRGH,
  HOOD_ID_TOONTOWN_CENTRAL,
  HOOD_ID_TUTORIAL,
} from "../Globals";
import type { ToontownLoader } from "../Loader";
import {
  type PandaNode,
  Texture,
  TextureAttrib,
  TransformState,
} from "../nodes";
import { Python2Random } from "../util/Python2Random";
import { BaseLoader } from "./BaseLoader";

const DNA_MAP: Record<number, string[]> = {
  [HOOD_ID_DONALDS_DOCK]: [
    "phase_6/dna/storage_DD",
    "phase_6/dna/donalds_dock_",
  ],
  [HOOD_ID_TOONTOWN_CENTRAL]: [
    "phase_4/dna/storage_TT",
    "phase_5/dna/toontown_central_",
  ],
  [HOOD_ID_MINNIES_MELODYLAND]: [
    "phase_6/dna/storage_MM",
    "phase_6/dna/minnies_melody_land_",
  ],
  [HOOD_ID_THE_BRRRGH]: ["phase_8/dna/storage_BR", "phase_8/dna/the_burrrgh_"],
  [HOOD_ID_DAISY_GARDENS]: [
    "phase_8/dna/storage_DG",
    "phase_8/dna/daisys_garden_",
  ],
  [HOOD_ID_DONALDS_DREAMLAND]: [
    "phase_8/dna/storage_DL",
    "phase_8/dna/donalds_dreamland_",
  ],
};

const SIGN_LEFT = -4;
const SIGN_RIGHT = 4;
const SIGN_BOTTOM = -3.5;
const SIGN_TOP = 1.5;

export class ToonInteriorLoader extends BaseLoader {
  private _branchZoneDna: string;
  private _interior: PandaNode | null = null;

  constructor(
    scene: PandaNode,
    loader: ToontownLoader,
    private zoneId: number,
  ) {
    super(scene, loader);
    const hoodId = getHoodId(this.zoneId);
    const branchZone = getBranchZone(this.zoneId);
    const zoneDnas = DNA_MAP[hoodId].slice();
    const zoneDnaPrefix = zoneDnas.pop();
    if (hoodId === branchZone) {
      if (hoodId === HOOD_ID_TOONTOWN_CENTRAL) {
        // TT safezone is in a different phase... should put this logic
        // in globals probably
        this._branchZoneDna = `phase_4/dna/toontown_central_sz`;
      } else {
        this._branchZoneDna = `${zoneDnaPrefix}sz`;
      }
    } else {
      this._branchZoneDna = `${zoneDnaPrefix}${branchZone}`;
    }
    this.storageDNAFiles.push(
      "phase_3.5/dna/storage_interior",
      ...zoneDnas,
      this._branchZoneDna,
    );
  }

  override async load(): Promise<void> {
    await super.load();
    await this.sceneBuilder.preloadModels();
    this.loadInterior();
    this.loadSign();
    await this.spawnNpcs(this.scene, this.zoneId);
  }

  private loadInterior(): void {
    // Initialize PRNG with zone ID (replicates Python 2 behavior)
    const rng = new Python2Random(this.zoneId);

    // Get the color scheme for this hood
    const hoodId = getHoodId(this.zoneId);
    const colors = ToonInteriorColors[hoodId];

    // Pick a random room
    const roomCode = randomDNAItem("TI_room", this.storage, rng);
    if (!roomCode) {
      console.warn("No room codes found in TI_room category");
      return;
    }

    this._interior = this.sceneBuilder.addGeometryFromCode(
      roomCode,
      this.scene,
    );
    if (!this._interior) {
      console.warn(`Failed to load room: ${roomCode}`);
      return;
    }
    this._interior.name = "interior";

    // Replace all random nodes
    replaceRandomInModel(
      this._interior,
      this.storage,
      this.loader,
      this.sceneBuilder,
      rng,
      colors,
      this.zoneId,
    );

    // Setup door
    const doorOrigin = this._interior.find("**/door_origin");
    if (!doorOrigin) {
      console.warn("Failed to find door_origin");
      return;
    }

    const door = this.sceneBuilder.addGeometryFromCode(
      "door_double_round_ur",
      doorOrigin,
    );
    if (door) {
      // Scale down door (rooms are small)
      doorOrigin.scale = vec3.fromValues(0.8, 0.8, 0.8);
      // Move away from wall
      doorOrigin.transform = doorOrigin.transform.compose(
        TransformState.fromPos(vec3.fromValues(0, -0.025, 0)),
      );

      // Apply door color
      const doorColors = colors.TI_door;
      if (doorColors && doorColors.length > 0) {
        const doorColor = rng.choice(doorColors);
        door.setColor(doorColor);
      }
    }
  }

  private async loadSign(): Promise<void> {
    const interior = this._interior;
    if (!interior) return;
    const blockId = this.zoneId % 100;
    const regex = new RegExp(`^[a-z]{2}${blockId}:`);
    const branchZoneDna = await this.loader.loadDNAInternal(
      this._branchZoneDna,
    );
    let signNode: PandaNode | null = null;
    const queue = branchZoneDna.root.slice();
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) continue;
      if (node.type === "landmark_building" && node.name.match(regex)) {
        const sign = node.children.find((child) => child.type === "sign");
        if (sign) {
          signNode = this.sceneBuilder.visitSignInterior(sign, interior);
          break;
        }
      }
      queue.push(...node.children);
    }
    if (!signNode) return;

    signNode.pos = vec3.create();
    const aabb = signNode.calcTightBounds();
    const center = vec3.create();
    aabb.centerPoint(center);

    // Calculate scale
    const width = aabb.max[0] - aabb.min[0];
    const height = aabb.max[2] - aabb.min[2];
    const xScale = (SIGN_RIGHT - SIGN_LEFT) / width;
    const yScale = (SIGN_TOP - SIGN_BOTTOM) / height;
    const scale = Math.min(xScale, yScale);
    const scaleVec = vec3.fromValues(scale, 1, scale);
    vec3.multiply(scaleVec, scaleVec, signNode.scale);

    // Position sign, overwriting existing position, preserving rotation and scale
    signNode.transform = TransformState.fromPosHprScale(
      vec3.fromValues(
        (SIGN_RIGHT + SIGN_LEFT) / 2.0 - center[0] * scale,
        -0.1,
        (SIGN_TOP + SIGN_BOTTOM) / 2.0 - center[2] * scale,
      ),
      signNode.hpr,
      scaleVec,
    );
  }

  override getDropPoints(): readonly [ReadonlyVec3, number][] {
    return [[vec3.fromValues(0, 0, 0.025), 0]];
  }
}

/**
 * Picks a random DNA item from a category using Python 2-compatible PRNG.
 */
function randomDNAItem(
  category: string,
  storage: DNAStorage,
  rng: Python2Random,
): string | undefined {
  const codeCount = storage.getNumCatalogCodes(category);
  if (codeCount === 0) return undefined;
  const index = rng.randint(0, codeCount - 1);
  return storage.getCatalogCode(category, index);
}

/**
 * Replace random_xxx_* nodes in a model with random items.
 * Replicates Python's DistributedToonInterior.replaceRandomInModel.
 */
function replaceRandomInModel(
  model: PandaNode,
  storage: DNAStorage,
  loader: ToontownLoader,
  builder: DNASceneBuilder,
  rng: Python2Random,
  colors: Record<string, ReadonlyVec4[]>,
  zoneId: number,
): void {
  const baseTag = "random_";
  const randomNodes = model.findAllMatches(`**/${baseTag}???_*`);

  for (const np of randomNodes) {
    const name = np.name;
    const b = baseTag.length;
    const category = name.substring(b + 4); // e.g., "TI_floor"
    const key1 = name[b]; // 'm' or 't' (model or texture)
    const key2 = name[b + 1]; // 'c', 'o', or 'r' (color, only, or recurse)

    let newNP: PandaNode | null = null;

    if (key1 === "m") {
      // Model replacement
      const code = randomDNAItem(category, storage, rng);
      if (!code) continue;

      newNP = builder.addGeometryFromCode(code, np);
      if (!newNP) continue;

      if (key2 === "r") {
        // Recurse into the new model
        replaceRandomInModel(
          newNP,
          storage,
          loader,
          builder,
          rng,
          colors,
          zoneId,
        );
      }
    } else if (key1 === "t") {
      // Texture replacement
      const code = randomDNAItem(category, storage, rng);
      if (!code) continue;

      const texturePath = storage.findTexture(code);
      if (!texturePath) continue;

      const attrib = new TextureAttrib();
      attrib.texture = new Texture();
      attrib.texture.name = code;
      attrib.texture.filename = texturePath;
      np.setAttrib(attrib, 100);
      newNP = np;
    }

    if (key2 === "c" && newNP) {
      // Apply color
      const categoryColors = colors[category];
      if (categoryColors && categoryColors.length > 0) {
        // For wallpaper and wallpaper_border, reseed the RNG
        if (category === "TI_wallpaper" || category === "TI_wallpaper_border") {
          const colorRng = new Python2Random(zoneId);
          newNP.setColorScale(colorRng.choice(categoryColors));
        } else {
          newNP.setColorScale(rng.choice(categoryColors));
        }
      }
    }
  }
}

type ColorScheme = {
  TI_wainscotting: vec4[];
  TI_wallpaper: vec4[];
  TI_wallpaper_border: vec4[];
  TI_door: vec4[];
  TI_floor: vec4[];
};

const wainscottingBase: vec4[] = [
  vec4.fromValues(0.8, 0.5, 0.3, 1.0),
  vec4.fromValues(0.699, 0.586, 0.473, 1.0),
  vec4.fromValues(0.473, 0.699, 0.488, 1.0),
];

const wallpaperBase: vec4[] = [
  vec4.fromValues(1.0, 1.0, 0.7, 1.0),
  vec4.fromValues(0.8, 1.0, 0.7, 1.0),
  vec4.fromValues(0.4, 0.5, 0.4, 1.0),
  vec4.fromValues(0.5, 0.7, 0.6, 1.0),
];

const wallpaperBorderBase: vec4[] = [
  vec4.fromValues(1.0, 1.0, 0.7, 1.0),
  vec4.fromValues(0.8, 1.0, 0.7, 1.0),
  vec4.fromValues(0.4, 0.5, 0.4, 1.0),
  vec4.fromValues(0.5, 0.7, 0.6, 1.0),
];

const doorBase: vec4[] = [vec4.fromValues(1.0, 1.0, 0.7, 1.0)];

const floorBase: vec4[] = [
  vec4.fromValues(0.746, 1.0, 0.477, 1.0),
  vec4.fromValues(1.0, 0.684, 0.477, 1.0),
];

const baseScheme: ColorScheme = {
  TI_wainscotting: wainscottingBase,
  TI_wallpaper: wallpaperBase,
  TI_wallpaper_border: wallpaperBorderBase,
  TI_door: doorBase,
  TI_floor: floorBase,
};

const ToonInteriorColors: Record<number, ColorScheme> = {
  [HOOD_ID_DONALDS_DOCK]: {
    TI_wainscotting: wainscottingBase,
    TI_wallpaper: wallpaperBase,
    TI_wallpaper_border: wallpaperBorderBase,
    TI_door: doorBase,
    TI_floor: floorBase,
  },
  [HOOD_ID_TOONTOWN_CENTRAL]: {
    TI_wainscotting: wainscottingBase,
    TI_wallpaper: wallpaperBase,
    TI_wallpaper_border: wallpaperBorderBase,
    TI_door: [...doorBase, vec4.fromValues(0.8, 0.5, 0.3, 1.0)],
    TI_floor: floorBase,
  },
  [HOOD_ID_THE_BRRRGH]: baseScheme,
  [HOOD_ID_MINNIES_MELODYLAND]: baseScheme,
  [HOOD_ID_DAISY_GARDENS]: baseScheme,
  [HOOD_ID_GOOFY_SPEEDWAY]: baseScheme,
  [HOOD_ID_DONALDS_DREAMLAND]: {
    TI_wainscotting: wainscottingBase,
    TI_wallpaper: wallpaperBase,
    TI_wallpaper_border: wallpaperBorderBase,
    TI_door: doorBase,
    TI_floor: floorBase,
  },
  [HOOD_ID_TUTORIAL]: {
    TI_wainscotting: wainscottingBase,
    TI_wallpaper: wallpaperBase,
    TI_wallpaper_border: wallpaperBorderBase,
    TI_door: [...doorBase, vec4.fromValues(0.8, 0.5, 0.3, 1.0)],
    TI_floor: floorBase,
  },
  [HOOD_ID_MY_ESTATE]: baseScheme,
};
