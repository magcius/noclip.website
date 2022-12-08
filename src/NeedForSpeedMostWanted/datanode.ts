import ArrayBufferSlice from '../ArrayBufferSlice';

export class NfsNode {
    public children: NfsNode[] = [];
    public dataBuffer: ArrayBufferSlice;
    public dataView: DataView;
    public type: NodeType;

    constructor(data: ArrayBufferSlice, type: number = 0xffffffff) {
        this.dataBuffer = data;
        this.dataView = data.createDataView();
        this.type = type;
    }

    public parseChildren() {
        if(this.children.length > 0) {
            console.warn("Node has already been parsed.");
            return;
        }

        let offset = 0;
        while(offset < this.dataBuffer.byteLength) {
            const nodeType = this.dataView.getUint32(offset, true);
            const nodeLength = this.dataView.getUint32(offset + 4, true);
            offset += 8;
            if(nodeType != 0) {
                let paddingLength = 0;
                while(paddingLength < nodeLength && this.dataView.getUint32(offset + paddingLength) == 0x11111111) {
                    paddingLength += 4;
                }
                const child = new NfsNode(this.dataBuffer.slice(offset + paddingLength, offset + nodeLength), nodeType);
                this.children.push(child);
                if(isDirectory(nodeType)) {
                    child.parseChildren();
                }
            }
            offset += nodeLength;
        }
    }
}

export enum NodeType {
    ModelCollection                     = 0x80134000,
        ModelCollectionHeader               = 0x80134001,
            ModelCollectionInfo                 = 0x00134002,
            ModelCollectionIdList               = 0x00134003,
        Model                               = 0x80134010,
            ModelInfo                           = 0x00134011,
            ModelTextureList                    = 0x00134012,
            ModelLights                         = 0x0013401a,
            Mesh                                = 0x80134100,
                MeshHeader                          = 0x00134900,
                MeshSubmeshInfo                     = 0x00134b02,
                MeshIndices                         = 0x00134b03,
                MeshVertexList                      = 0x00134b01,
                MeshMaterialName                    = 0x00134c02,

    InstanceList                        = 0x80034100,
        InstanceListHeader                  = 0x00034101,
        InstanceListLocationData            = 0x00034103,
        InstanceListModels                  = 0x00034102,
        InstanceListBvh                     = 0x00034105,
        InstanceListScriptIds               = 0x00034106,
        // Unknown                          = 0x00034107,

    TextureCollection                   = 0xB3300000,
        TextureCollectionHeader                 = 0xB3310000,
            // Unknown                              = 0x33310001,
            TextureCollectionIdList                 = 0x33310002,
            TextureCollectionTexInfo                = 0x33310004,
            TextureCollectionTexFormat              = 0x33310005,
        TextureDataContainer                    = 0xB3320000,
            // Unknown                              = 0x33320001,
            TextureData                             = 0x33320002,

    CollisionData                       = 0x0003B801,
    DestructiblesList                   = 0x00034027,
    TextureAnimation                    = 0xB0300100,
    ParticleEmitter                     = 0x0003BC00,
    // Unknown                          = 0x00036003
    // Unknown                          = 0x00036001
    // Unknown                          = 0x00036002
    // Unknown                          = 0x00034159    

    RegionDefinitions                   = 0x80034150,
    DataSectionDefinitions              = 0x00034110,
    AiPaths                             = 0x0003B800
}

function isDirectory(type: number) {
    // Checks if highest bit is set to 1
    return (type & 0x80000000) != 0;
}
