import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { SceneContext } from "../SceneBase";
import type { SceneGfx } from "../viewer";
import {
  getHoodId,
  HOOD_ID_DAISY_GARDENS,
  HOOD_ID_DONALDS_DOCK,
  HOOD_ID_DONALDS_DREAMLAND,
  HOOD_ID_GOLF_ZONE,
  HOOD_ID_GOOFY_SPEEDWAY,
  HOOD_ID_MINNIES_MELODYLAND,
  HOOD_ID_MY_ESTATE,
  HOOD_ID_OUTDOOR_ZONE,
  HOOD_ID_PARTY_ZONE,
  HOOD_ID_THE_BRRRGH,
  HOOD_ID_TOONTOWN_CENTRAL,
  INTERIOR_ZONE_DATA,
  InteriorZoneType,
  ZONE_ID_BOSSBOT_HQ,
  ZONE_ID_CASHBOT_HQ,
  ZONE_ID_INTERIOR_OFFSET,
  ZONE_ID_LAWBOT_HQ,
  ZONE_ID_SELLBOT_HQ,
  ZONE_ID_TUTORIAL_TERRACE,
} from "./Globals";
import { ToontownLoader } from "./Loader";
import type { SceneLoader } from "./loaders";
import { BossbotCogHQLoader } from "./loaders/BossbotCogHQLoader";
import { BRSafeZoneLoader } from "./loaders/BRSafeZoneLoader";
import { BRTownLoader } from "./loaders/BRTownLoader";
import { CashbotCogHQLoader } from "./loaders/CashbotCogHQLoader";
import { DDSafeZoneLoader } from "./loaders/DDSafeZoneLoader";
import { DDTownLoader } from "./loaders/DDTownLoader";
import { DGSafeZoneLoader } from "./loaders/DGSafeZoneLoader";
import { DGTownLoader } from "./loaders/DGTownLoader";
import { DLSafeZoneLoader } from "./loaders/DLSafeZoneLoader";
import { DLTownLoader } from "./loaders/DLTownLoader";
import { EstateLoader } from "./loaders/EstateLoader";
import { GSSafeZoneLoader } from "./loaders/GSSafeZoneLoader";
import { GZSafeZoneLoader } from "./loaders/GZSafeZoneLoader";
import { KartShopInteriorLoader } from "./loaders/KartShopInteriorLoader";
import { LawbotCogHQLoader } from "./loaders/LawbotCogHQLoader";
import { MMSafeZoneLoader } from "./loaders/MMSafeZoneLoader";
import { MMTownLoader } from "./loaders/MMTownLoader";
import { OZSafeZoneLoader } from "./loaders/OZSafeZoneLoader";
import { PartyLoader } from "./loaders/PartyLoader";
import { SellbotCogHQLoader } from "./loaders/SellbotCogHQLoader";
import { ToonInteriorLoader } from "./loaders/ToonInteriorLoader";
import { TTSafeZoneLoader } from "./loaders/TTSafeZoneLoader";
import { TTTownLoader } from "./loaders/TTTownLoader";
import { TutorialTownLoader } from "./loaders/TutorialTownLoader";
import { PandaNode } from "./nodes";
import { ToontownRenderer } from "./Render";

type SafeZoneLoaderClass = new (
  scene: PandaNode,
  loader: ToontownLoader,
) => SceneLoader;

type TownLoaderClass = new (
  scene: PandaNode,
  loader: ToontownLoader,
  zoneId: number,
) => SceneLoader;

const HOOD_LOADERS: Record<
  number,
  [SafeZoneLoaderClass | null, TownLoaderClass | null]
> = {
  [HOOD_ID_DONALDS_DOCK]: [DDSafeZoneLoader, DDTownLoader],
  [HOOD_ID_TOONTOWN_CENTRAL]: [TTSafeZoneLoader, TTTownLoader],
  [HOOD_ID_THE_BRRRGH]: [BRSafeZoneLoader, BRTownLoader],
  [HOOD_ID_MINNIES_MELODYLAND]: [MMSafeZoneLoader, MMTownLoader],
  [HOOD_ID_DAISY_GARDENS]: [DGSafeZoneLoader, DGTownLoader],
  [HOOD_ID_OUTDOOR_ZONE]: [OZSafeZoneLoader, null],
  [HOOD_ID_GOOFY_SPEEDWAY]: [GSSafeZoneLoader, null],
  [HOOD_ID_DONALDS_DREAMLAND]: [DLSafeZoneLoader, DLTownLoader],
  [ZONE_ID_TUTORIAL_TERRACE]: [TutorialTownLoader, null],
  [HOOD_ID_MY_ESTATE]: [EstateLoader, null],
  [HOOD_ID_GOLF_ZONE]: [GZSafeZoneLoader, null],
  [ZONE_ID_BOSSBOT_HQ]: [null, BossbotCogHQLoader],
  [ZONE_ID_SELLBOT_HQ]: [null, SellbotCogHQLoader],
  [ZONE_ID_CASHBOT_HQ]: [null, CashbotCogHQLoader],
  [ZONE_ID_LAWBOT_HQ]: [null, LawbotCogHQLoader],
  [HOOD_ID_PARTY_ZONE]: [PartyLoader, null],
};

function getLoaderForZoneId(
  scene: PandaNode,
  loader: ToontownLoader,
  zoneId: number,
): SceneLoader {
  const hoodId = getHoodId(zoneId);
  const loaders = HOOD_LOADERS[hoodId];
  if (!loaders) throw new Error(`No loaders found for hoodId ${hoodId}`);
  const [safeZoneLoaderClass, townLoaderClass] = loaders;
  if (zoneId === hoodId && safeZoneLoaderClass) {
    return new safeZoneLoaderClass(scene, loader);
  }
  if (zoneId - hoodId < ZONE_ID_INTERIOR_OFFSET && townLoaderClass) {
    return new townLoaderClass(scene, loader, zoneId);
  }
  const interiorZoneData = INTERIOR_ZONE_DATA[zoneId];
  if (interiorZoneData) {
    const [_, zoneType] = interiorZoneData;
    switch (zoneType) {
      case InteriorZoneType.ToonInterior:
        return new ToonInteriorLoader(scene, loader, zoneId);
      case InteriorZoneType.KartShop:
        return new KartShopInteriorLoader(scene, loader);
    }
  }
  throw new Error(`No loader found for zoneId ${zoneId}`);
}

export async function createScene(
  device: GfxDevice,
  context: SceneContext,
  zoneId: number,
): Promise<SceneGfx> {
  const loader = await context.dataShare.ensureObject<ToontownLoader>(
    `Toontown/loader`,
    async () => {
      const loader = new ToontownLoader(context.dataFetcher);
      await loader.loadManifest();
      return loader;
    },
  );

  // Setup scene graph
  const scene = PandaNode.create("render");
  scene.attachNewNode("camera");

  // Execute scene loader
  const sceneLoader = getLoaderForZoneId(scene, loader, zoneId);
  await sceneLoader.load();
  return ToontownRenderer.create(device, scene, loader, sceneLoader);
}
