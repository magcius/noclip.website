import { DataFetcher } from '../../DataFetcher';
import { SceneContext } from '../../SceneBase';
import { downloadBlob } from '../../DownloadUtils';
import type { Asset, Mesh } from '../../../rust/pkg/index';

let _wasm: any | null = null;

async function loadWasm() {
    if (_wasm === null) {
        _wasm = await import('../../../rust/pkg/index');
    }
    return _wasm;
}

const MAX_HEADER_LENGTH = 4096;

function concatBufs(a: Uint8Array, b: Uint8Array): Uint8Array {
    let result = new Uint8Array(a.byteLength + b.byteLength);
    result.set(a);
    result.set(b, a.byteLength);
    return result;
}

interface Range {
    rangeStart: number,
    rangeSize: number,
}

interface MeshData {
    name: string,
    offset: number,
    size: number,
}

export class UnityAssetManager {
    private asset: Asset;
    private fetcher: DataFetcher;

    constructor(public assetPath: string, private context: SceneContext) {
    }

    private async loadBytes(range: Range): Promise<Uint8Array> {
        let res = await this.context.dataFetcher.fetchData(this.assetPath, range);
        return new Uint8Array(res.arrayBuffer);
    }

    public async load() {
        let wasm = await loadWasm();
        let headerBytes = await this.loadBytes({
            rangeStart: 0,
            rangeSize: MAX_HEADER_LENGTH,
        });
        let assetHeader = wasm.AssetHeader.deserialize(headerBytes);
        if (assetHeader.data_offset > headerBytes.byteLength) {
            let range = {
                rangeStart: headerBytes.byteLength,
                rangeSize: assetHeader.data_offset - headerBytes.byteLength,
            };
            let extraBytes = await this.loadBytes(range);
            headerBytes = concatBufs(headerBytes, extraBytes);
        }
        this.asset = wasm.Asset.deserialize(headerBytes);
    }

    public async downloadMeshData() {
        let wasm = await loadWasm();
        let assetData = await this.context.dataFetcher.fetchData(this.assetPath);
        let meshDataArray = wasm.get_mesh_data(this.asset, assetData);
        let result: MeshData[] = [];
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

    public async loadMesh(meshData: MeshData): Promise<Mesh> {
        let wasm = await loadWasm();
        let range = { rangeStart: meshData.offset, rangeSize: meshData.size };
        let meshBytes = await this.loadBytes(range);
        return wasm.Mesh.from_bytes(meshBytes, this.asset);
    }
}