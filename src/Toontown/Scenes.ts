import type { GfxDevice } from "../gfx/platform/GfxPlatform";
import type { SceneContext } from "../SceneBase";
import type { SceneDesc, SceneGfx, SceneGroup } from "../viewer";
import {
  HOOD_HEIRARCHY,
  INTERIOR_ZONE_DATA,
  InteriorZoneType,
  STREET_NAMES,
} from "./Globals";

const HIDE_INTERIOR_SCENES = true;

class ToontownSceneDesc implements SceneDesc {
  constructor(
    public id: string,
    public name: string,
    public zoneId: number,
    public hidden?: boolean,
  ) {}

  public async createScene(
    device: GfxDevice,
    context: SceneContext,
  ): Promise<SceneGfx> {
    // Use async import for code splitting
    return (await import("./SceneLoader")).createScene(
      device,
      context,
      this.zoneId,
    );
  }
}

const sceneDescs: (string | SceneDesc)[] = [];
for (const [hoodId, branchZoneIds] of HOOD_HEIRARCHY.entries()) {
  const hoodName = STREET_NAMES[hoodId];
  if (!hoodName) throw new Error(`Missing name for hood ${hoodId}`);
  sceneDescs.push(hoodName);
  for (const branchZoneId of branchZoneIds) {
    const name =
      STREET_NAMES[branchZoneId] ?? INTERIOR_ZONE_DATA[branchZoneId]?.[0];
    if (!name) throw new Error(`Missing name for zone ${branchZoneId}`);
    sceneDescs.push(
      new ToontownSceneDesc(`zone_${branchZoneId}`, name, branchZoneId),
    );
  }
}
if (!HIDE_INTERIOR_SCENES) sceneDescs.push("Interiors");
for (const [zoneIdStr, [name, type]] of Object.entries(INTERIOR_ZONE_DATA)) {
  const zoneId = parseInt(zoneIdStr, 10);
  let nameStr = name;
  if (!nameStr) {
    switch (type) {
      case InteriorZoneType.GagShop:
        nameStr = "Gag Shop";
        break;
      case InteriorZoneType.ToonHQ:
        nameStr = "Toon HQ";
        break;
      case InteriorZoneType.ClothingShop:
        nameStr = "Clothing Shop";
        break;
      case InteriorZoneType.PetShop:
        nameStr = "Pet Shop";
        break;
      default:
        nameStr = "Unknown";
        break;
    }
  }
  sceneDescs.push(
    new ToontownSceneDesc(
      `zone_${zoneId}`,
      nameStr,
      zoneId,
      HIDE_INTERIOR_SCENES,
    ),
  );
}

export const sceneGroup: SceneGroup = {
  id: "Toontown",
  name: "Toontown Online",
  sceneDescs,
};
