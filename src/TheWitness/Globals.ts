import { Entity_Manager } from "./Entity";
import { Asset_Manager } from "./Assets";
import { GfxDevice } from "../gfx/platform/GfxPlatform";

export class TheWitnessGlobals {
    public entity_manager = new Entity_Manager();
    public asset_manager: Asset_Manager;

    public destroy(device: GfxDevice): void {
        this.asset_manager.destroy(device);
    }
}
