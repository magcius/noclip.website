import { DataFetcher } from '../../DataFetcher';
import { SceneContext } from '../../SceneBase';
import { downloadBlob } from '../../DownloadUtils';
import type { AssetInfo, Mesh } from '../../../rust/pkg/index';

let _wasm: any | null = null;

async function loadWasm() {
    return await import('../../../rust/pkg/index');
}

const MAX_HEADER_LENGTH = 4096;

function concatBufs(a: Uint8Array, b: Uint8Array): Uint8Array {
    let result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(a);
    result.set(b, a.byteLength);
    return result;
}

interface Range {
    rangeStart: number;
    rangeSize: number;
}

export interface MeshMetadata {
    name: string;
    offset: number;
    size: number;
}

export class UnityAssetManager {
    private assetInfo: AssetInfo;
    private fetcher: DataFetcher;

    constructor(public assetPath: string, private context: SceneContext) {
    }

    private async loadBytes(range: Range): Promise<Uint8Array> {
        let res = await this.context.dataFetcher.fetchData(this.assetPath, range);
        return new Uint8Array(res.arrayBuffer);
    }

    public async loadAssetInfo() {
        let wasm = await loadWasm();
        let headerBytes = await this.loadBytes({
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        });
        let assetHeader = wasm.AssetHeader.deserialize(headerBytes);
        if (assetHeader.data_offset > headerBytes.byteLength) {
            let extraBytes = await this.loadBytes({
                rangeStart: headerBytes.byteLength,
                rangeSize: assetHeader.data_offset - headerBytes.byteLength,
            });
            headerBytes = concatBufs(headerBytes, extraBytes);
        }
        this.assetInfo = wasm.AssetInfo.deserialize(headerBytes);
    }

    public async downloadMeshMetadata() {
        let wasm = await loadWasm();
        let assetData = await this.context.dataFetcher.fetchData(this.assetPath);
        let assetBytes = new Uint8Array(assetData.arrayBuffer);
        let meshDataArray = wasm.get_mesh_metadata(this.assetInfo, assetBytes);
        let result: MeshMetadata[] = [];
        for (let i=0; i<meshDataArray.length; i++) {
            let data = meshDataArray.get(i);
            result.push({
                name: data.get_name(),
                offset: data.offset,
                size: data.size,
            })
        }

        downloadBlob('meshData.assetPath}.json', new Blob([JSON.stringify(result, null, 2)]));
    }

    public async loadMesh(meshData: MeshMetadata): Promise<Mesh> {
        let wasm = await loadWasm();
        let meshBytes = await this.loadBytes({
            rangeStart: meshData.offset,
            rangeSize: meshData.size,
        });
        return wasm.Mesh.from_bytes(meshBytes, this.assetInfo);
    }
}