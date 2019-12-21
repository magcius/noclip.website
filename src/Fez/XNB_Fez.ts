
import { ContentReader, ContentTypeReader, XNA_Texture2D, ContentTypeReaderManager, XNA_PrimitiveType } from "./XNB";
import { vec3, vec2 } from "gl-matrix";
import { assertExists } from "../util";

// Fez implementation of XNB.

export interface Fez_ArtObject {
    name: string;
    futureCubeMap: XNA_Texture2D;
    size: vec3;
    geometry: Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>;
    actorType: number;
    noSilhouette: boolean;
}

function Fez_ArtObjectReader(reader: ContentReader): Fez_ArtObject {
    const name = reader.ReadString();
    const futureCubeMap = assertExists(reader.ReadObject<XNA_Texture2D>());
    const size = reader.ReadVector3();
    const geometry = reader.ReadObject<Fez_ShaderInstancedIndexedPrimitives<Fez_VertexPositionNormalTextureInstance>>()!;
    const actorType = reader.ReadObject<number>()!;
    const noSilhouette = reader.ReadBoolean();
    return { name, futureCubeMap, size, geometry, actorType, noSilhouette };
}

interface Fez_ShaderInstancedIndexedPrimitives<T> {
    primitiveType: XNA_PrimitiveType;
    vertices: T[];
    indices: number[];
}

function Fez_ShaderInstancedIndexedPrimitivesReader_Factory(typeReaders: ContentTypeReader[]): ContentTypeReader {
    return (reader: ContentReader): Fez_ShaderInstancedIndexedPrimitives<any> => {
        const primitiveType = reader.ReadObject<XNA_PrimitiveType>()!;
        const vertices = reader.ReadObject<any>()!;
        const indices = reader.ReadObject<number[]>()!;
        return { primitiveType, vertices, indices };
    };
}

const normals = [
    vec3.fromValues(-1, 0, 0), 
    vec3.fromValues(0, -1, 0), 
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(1, 0, 0), 
    vec3.fromValues(0, 1, 0), 
    vec3.fromValues(0, 0, 1),
];

interface Fez_VertexPositionNormalTextureInstance {
    position: vec3;
    normal: vec3;
    texcoord: vec2;
}

function Fez_VertexPositionNormalTextureInstanceReader(reader: ContentReader): Fez_VertexPositionNormalTextureInstance {
    const position = reader.ReadVector3();
    const normalByte = reader.ReadByte();
    const normal = normals[normalByte];
    const texcoord = reader.ReadVector2();
    return { position, normal, texcoord };
}

export class FezContentTypeReaderManager extends ContentTypeReaderManager {
    constructor() {
        super();
        this.RegisterTypeReaderDirect(Fez_ArtObjectReader,
            'FezEngine.Structures.ArtObject',
            'FezEngine.Readers.ArtObjectReader');
        this.RegisterTypeReaderDirect(Fez_VertexPositionNormalTextureInstanceReader,
            'FezEngine.Structure.Geometry.VertexPositionNormalTextureInstance',
            'FezEngine.Readers.VertexPositionNormalTextureInstanceReader');
        this.RegisterTypeReaderGenericFactory(Fez_ShaderInstancedIndexedPrimitivesReader_Factory,
            'FezEngine.Structure.Geometry.ShaderInstancedIndexedPrimitives',
            'FezEngine.Readers.ShaderInstancedIndexedPrimitivesReader');
    }
}
