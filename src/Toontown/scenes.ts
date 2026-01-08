import type { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import type { SceneContext } from "../SceneBase.js";
import type * as Viewer from "../viewer.js";
import { ToontownRenderer } from "./render.js";
import { pathBase, ToontownResourceLoader } from "./resources.js";

class ToontownSceneDesc implements Viewer.SceneDesc {
  constructor(
    public id: string,
    public name: string,
    public modelPath: string,
  ) {}

  public async createScene(
    device: GfxDevice,
    context: SceneContext,
  ): Promise<Viewer.SceneGfx> {
    const loader = await context.dataShare.ensureObject<ToontownResourceLoader>(
      `${pathBase}/loader`,
      async () => {
        const loader = new ToontownResourceLoader();
        await loader.loadManifest(context.dataFetcher);
        return loader;
      },
    );

    const bamFile = await loader.loadModel(
      this.modelPath,
      context.dataFetcher,
      true,
    );

    return ToontownRenderer.create(
      device,
      bamFile,
      loader,
      context.dataFetcher,
    );
  }
}

const sceneDescs = [
  "Neighborhoods",
  new ToontownSceneDesc(
    "toontown_central",
    "Toontown Central",
    "phase_4/models/neighborhoods/toontown_central.bam",
  ),
  new ToontownSceneDesc(
    "donalds_dock",
    "Donald's Dock",
    "phase_6/models/neighborhoods/donalds_dock.bam",
  ),
  new ToontownSceneDesc(
    "minnies_melody_land",
    "Minnie's Melody Land",
    "phase_6/models/neighborhoods/minnies_melody_land.bam",
  ),
  new ToontownSceneDesc(
    "daisys_garden",
    "Daisy's Garden",
    "phase_8/models/neighborhoods/daisys_garden.bam",
  ),
  new ToontownSceneDesc(
    "the_burrrgh",
    "The Burrrgh",
    "phase_8/models/neighborhoods/the_burrrgh.bam",
  ),
  new ToontownSceneDesc(
    "donalds_dreamland",
    "Donald's Dreamland",
    "phase_8/models/neighborhoods/donalds_dreamland.bam",
  ),
  "Trolley Games",
  new ToontownSceneDesc(
    "icecreamdrop",
    "Catching Game",
    "phase_4/models/minigames/icecreamdrop.bam",
  ),
];

export const sceneGroup: Viewer.SceneGroup = {
  id: "Toontown",
  name: "Toontown Online",
  sceneDescs,
};
