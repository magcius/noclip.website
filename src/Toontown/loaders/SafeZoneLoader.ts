import type { ToontownLoader } from "../Loader";
import type { PandaNode } from "../nodes";
import { BaseLoader } from "./BaseLoader";

export class SafeZoneLoader extends BaseLoader {
  constructor(
    scene: PandaNode,
    loader: ToontownLoader,
    protected hoodId: number,
  ) {
    super(scene, loader);
  }

  override async load(): Promise<void> {
    await super.load();
    await this.spawnNpcs(this.scene, this.hoodId);
  }
}
