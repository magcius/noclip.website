import { DataFetcher } from "../DataFetcher.js";
import { HIAssetType } from "./HIAssetTypes.js";
import { HIAssetPickupTable } from "./HIEntPickup.js";
import { HILightKit } from "./HILightKit.js";
import { HIMarkerAsset } from "./HIMarkerAsset.js";
import { HIModelAssetInfo, HIPipeInfoTable } from "./HIModel.js";
import { HIPAsset, HIPFile } from "./HIP.js";
import { HIGame } from "./HIScene.js";
import { JSP } from "./JSP.js";
import { RpClump } from "./rw/rpworld.js";
import { RwEngine, RwPluginID, RwStream, RwTexDictionary, RwTexture } from "./rw/rwcore.js";

export class HIAssetManager {
    public hips: HIPFile[] = [];
    public jsps: JSP[] = [];

    public findAsset(id: number): HIPAsset | undefined {
        for (const hip of this.hips) {
            const asset = hip.findAsset(id);
            if (asset) {
                return asset;
            }
        }
        return undefined;
    }

    public findAssetByType(type: HIAssetType, idx: number = 0): HIPAsset | undefined {
        for (const hip of this.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    if (asset.type === type) {
                        if (idx === 0) {
                            return asset;
                        }
                        idx--;
                    }
                }
            }
        }
        return undefined;
    }

    private async fetchHIP(dataFetcher: DataFetcher, path: string) {
        const idx = this.hips.length++;
        const buf = await dataFetcher.fetchData(path);
        this.hips[idx] = HIPFile.read(buf);
    }

     public async load(dataFetcher: DataFetcher, hipPaths: string[], game: HIGame, rw: RwEngine): Promise<void> {
        for (const path of hipPaths) {
            this.fetchHIP(dataFetcher, path);
        }
        await dataFetcher.waitForLoad();

        let jsp = new JSP();

        for (const hip of this.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    switch (asset.type) {
                    case HIAssetType.LKIT:
                        asset.runtimeData = new HILightKit(new RwStream(asset.rawData), rw);
                        break;
                    case HIAssetType.JSP:
                        jsp.load(asset.rawData, rw);
                        if (jsp.nodeList.length > 0) {
                            asset.runtimeData = jsp;
                            this.jsps.push(jsp);
                            jsp = new JSP();
                        }
                        break;
                    case HIAssetType.MINF:
                        asset.runtimeData = new HIModelAssetInfo(new RwStream(asset.rawData));
                        break;
                    case HIAssetType.MRKR:
                        asset.runtimeData = new HIMarkerAsset(new RwStream(asset.rawData));
                        break;
                    case HIAssetType.MODL:
                        this.loadModel(asset, rw);
                        break;
                    case HIAssetType.PICK:
                        asset.runtimeData = new HIAssetPickupTable(new RwStream(asset.rawData));
                        break;
                    case HIAssetType.PIPT:
                        asset.runtimeData = new HIPipeInfoTable(new RwStream(asset.rawData), game);
                        break;
                    case HIAssetType.RWTX:
                        this.loadTexture(asset, rw);
                        break;
                    }
                }
            }
        }
    }

    public destroy(rw: RwEngine) {
        for (const hip of this.hips) {
            for (const layer of hip.layers) {
                for (const asset of layer.assets) {
                    switch (asset.type) {
                    case HIAssetType.LKIT:
                        (asset.runtimeData as HILightKit)?.destroy();
                        break;
                    case HIAssetType.JSP:
                        (asset.runtimeData as JSP)?.destroy(rw);
                        break;
                    case HIAssetType.MODL:
                        (asset.runtimeData as RpClump)?.destroy(rw);
                        break;
                    case HIAssetType.RWTX:
                        (asset.runtimeData as RwTexture)?.destroy(rw);
                        break;
                    }
                }
            }
        }
    }

    private loadModel(asset: HIPAsset, rw: RwEngine): boolean {
        if (asset.rawData.byteLength === 0) return true;

        const stream = new RwStream(asset.rawData);
        if (!stream.findChunk(RwPluginID.CLUMP)) {
            console.warn(`Clump not found in asset ${asset.name}`);
            return false;
        }

        const clump = RpClump.streamRead(stream, rw);
        if (!clump) return false;

        asset.runtimeData = clump;
        return true;
    }

    private loadTexture(asset: HIPAsset, rw: RwEngine): boolean {
        if (asset.rawData.byteLength === 0) return true;
        
        const stream = new RwStream(asset.rawData);
        if (!stream.findChunk(RwPluginID.TEXDICTIONARY)) {
            console.warn(`Tex dictionary not found in asset ${asset.name}`);
            return false;
        }
    
        const texDict = RwTexDictionary.streamRead(stream, rw);
        if (!texDict) return false;

        // We only use the first texture
        const texture = texDict.textures[0];
        texDict.removeTexture(texture);
        
        texDict.destroy(rw);
        
        asset.runtimeData = texture;
        return true;
    }
}