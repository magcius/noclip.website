import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { BaseLoader } from "./BaseLoader";

/**
 * Goofy's Auto Shop
 */
export class KartShopInteriorLoader extends BaseLoader {
  private static readonly ZONE_ID = 8501;

  constructor(scene: PandaNode, loader: ToontownLoader) {
    super(scene, loader);
    this.storageDNAFiles = [];
    this.musicFile = "phase_6/audio/bgm/GS_KartShop.mid";
  }

  override async load(): Promise<void> {
    // Load the Kart Shop interior model
    const model = await this.loader.loadModel(
      "phase_6/models/karting/KartShop_Interior",
    );
    model.cloneTo(this.scene);

    // Spawn NPCs for the Kart Shop zone
    await this.spawnNpcs(this.scene, KartShopInteriorLoader.ZONE_ID);
  }
}
