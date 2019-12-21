
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists, nArray } from "../util";
import { LZXState, decompressLZX } from "../Common/Compression/LZX";
import { vec3, vec2, mat4, vec4 } from "gl-matrix";

//#region ContentTypeReaderManager
export type ContentTypeReader = (reader: ContentReader) => any;
export type ContentTypeReaderGenericFactory = (paramsReaders: ContentTypeReader[]) => ContentTypeReader;

export class ContentTypeReaderManager {
    private directByReaderName = new Map<string, ContentTypeReader>();
    private directByTypeName = new Map<string, ContentTypeReader>();
    private genericByReaderName = new Map<string, ContentTypeReaderGenericFactory>();
    private valueTypes = new Set<ContentTypeReader>();

    constructor() {
        // Value Types
        this.RegisterTypeReaderValueType(XNA_UInt16Reader,
            'System.UInt16',
            'Microsoft.Xna.Framework.Content.UInt16Reader');
        this.RegisterTypeReaderValueType(XNA_UInt32Reader,
            'System.UInt32',
            'Microsoft.Xna.Framework.Content.UInt32Reader');
        this.RegisterTypeReaderValueType(XNA_Int32Reader,
            'System.Int32',
            'Microsoft.Xna.Framework.Content.Int32Reader');
        this.RegisterTypeReaderValueType(XNA_EnumReader,
            'System.Enum',
            'Microsoft.Xna.Framework.Content.EnumReader');

        // Primitive Types
        this.RegisterTypeReaderGenericFactory(XNA_ArrayReader_Factory,
            'System.Array',
            'Microsoft.Xna.Framework.Content.ArrayReader');
        this.RegisterTypeReaderGenericFactory(XNA_DictionaryReader_Factory,
            'System.Dictionary',
            'Microsoft.Xna.Framework.Content.DictionaryReader');

        this.RegisterTypeReaderDirect(XNA_Texture2DReader,
            'Microsoft.Xna.Framework.Graphics.Texture2D',
            'Microsoft.Xna.Framework.Content.Texture2DReader');
        this.RegisterTypeReaderDirect(XNA_MatrixReader,
            'Microsoft.Xna.Framework.Matrix',
            'Microsoft.Xna.Framework.Content.MatrixReader');
        this.RegisterTypeReaderDirect(XNA_Vector4Reader,
            'Microsoft.Xna.Framework.Vector4',
            'Microsoft.Xna.Framework.Content.Vector4Reader');
    }

    public IsValueType(typeReader: ContentTypeReader): boolean {
        return this.valueTypes.has(typeReader);
    }

    public RegisterTypeReaderDirect(typeReader: ContentTypeReader, typeName: string, readerClassName: string): void {
        this.directByReaderName.set(readerClassName, typeReader);
        this.directByTypeName.set(typeName, typeReader);
    }

    public RegisterTypeReaderValueType(typeReader: ContentTypeReader, typeName: string, readerClassName: string): void {
        this.directByReaderName.set(readerClassName, typeReader);
        this.directByTypeName.set(typeName, typeReader);
        this.valueTypes.add(typeReader);
    }

    public RegisterTypeReaderEnum(typeName: string): void {
        this.directByTypeName.set(typeName, XNA_EnumReader);
    }

    public RegisterTypeReaderGenericFactory(factory: ContentTypeReaderGenericFactory, typeName: string, readerClassName: string): void {
        this.genericByReaderName.set(readerClassName, factory);
    }

    private ConstructTypeReaderForTypeSpec_TypeName(typeSpec: TypeSpec): ContentTypeReader {
        assert(typeSpec.params === null);
        return assertExists(this.directByTypeName.get(typeSpec.className));
    }

    public ConstructTypeReaderForTypeSpec(typeSpec: TypeSpec): ContentTypeReader {
        const directVersion = this.directByReaderName.get(typeSpec.className);

        // If the directVersion exists, use it.
        if (directVersion !== undefined)
            return directVersion;

        if (typeSpec.params !== null) {
            const params = typeSpec.params.map((typeName) => this.ConstructTypeReaderForTypeSpec_TypeName(typeName));
            const factory = assertExists(this.genericByReaderName.get(typeSpec.className));
            return factory(params);
        } else {
            // Missing type.
            throw `Missing type: ${typeSpec.className}`;
        }
    }
}
//#endregion

//#region XNA Binary Format
export interface TypeSpec {
    className: string;
    ns: string | null;
    params: TypeSpec[] | null;
}

function parseTypeSpec(typename: string): TypeSpec {
    let className: string, ns: string | null = null, params: TypeSpec[] | null = null;

    // Hacks, for now.
    const paramsBegin = typename.indexOf('[[');
    if (paramsBegin > 0) {
        // Parse out the number of parameters to make sure it matches.
        const backtick = typename.indexOf('`');
        assert(backtick >= 0);
        const numParams = Number(typename.slice(backtick + 1, paramsBegin));
        className = typename.slice(0, backtick);
        const paramsEnd = typename.indexOf(']]');
        assert(paramsEnd >= 0);
        ns = typename.slice(paramsEnd + 4);
        params = [];
        for (let i = paramsBegin + 1; i < paramsEnd - 1; ) {
            assert(typename.charAt(i) === '[');
            // Look for the closing bracket.
            const otherBracket = typename.indexOf(']', i);
            params.push(parseTypeSpec(typename.slice(i + 1, otherBracket)));
            i = otherBracket + 1;
            const nextChar = typename.charAt(i);
            assert(nextChar === ',' || nextChar === ']');
            if (nextChar === ',')
                i++;
            else if (nextChar === ']')
                break;
        }
        assert(params.length === numParams);
    } else {
        const comma = typename.indexOf(', ');
        if (comma >= 0) {
            className = typename.slice(0, comma);
            ns = typename.slice(comma + 2);
        } else {
            className = typename;
            ns = null;
        }
    }

    return { className, ns, params };
}

export class ContentReader {
    public Position = 0;
    private view: DataView;
    private typeReaders: ContentTypeReader[] = [];

    constructor(private typeReaderManager: ContentTypeReaderManager, private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public ReadBytes(byteLength: number): ArrayBufferSlice {
        const v = this.buffer.subarray(this.Position, byteLength);
        this.Position += byteLength;
        return v;
    }

    public ReadByte(): number {
        return this.view.getUint8(this.Position++);
    }

    public ReadBoolean(): boolean {
        return !!this.ReadByte();
    }

    public ReadInt16(): number {
        const v = this.view.getInt16(this.Position, true);
        this.Position += 0x02;
        return v;
    }

    public ReadUInt16(): number {
        const v = this.view.getUint16(this.Position, true);
        this.Position += 0x02;
        return v;
    }

    public ReadInt32(): number {
        const v = this.view.getInt32(this.Position, true);
        this.Position += 0x04;
        return v;
    }

    public ReadUInt32(): number {
        const v = this.view.getUint32(this.Position, true);
        this.Position += 0x04;
        return v;
    }

    public ReadSingle(): number {
        const v = this.view.getFloat32(this.Position, true);
        this.Position += 0x04;
        return v;
    }

    public ReadVector2(): vec2 {
        const x = this.ReadSingle();
        const y = this.ReadSingle();
        return vec2.fromValues(x, y);
    }

    public ReadVector3(): vec3 {
        const x = this.ReadSingle();
        const y = this.ReadSingle();
        const z = this.ReadSingle();
        return vec3.fromValues(x, y, z);
    }

    public ReadVector4(): vec4 {
        const x = this.ReadSingle();
        const y = this.ReadSingle();
        const z = this.ReadSingle();
        const w = this.ReadSingle();
        return vec4.fromValues(x, y, z, w);
    }

    public ReadMatrix(): mat4 {
        const m00 = this.ReadSingle();
        const m01 = this.ReadSingle();
        const m02 = this.ReadSingle();
        const m03 = this.ReadSingle();
        const m10 = this.ReadSingle();
        const m11 = this.ReadSingle();
        const m12 = this.ReadSingle();
        const m13 = this.ReadSingle();
        const m20 = this.ReadSingle();
        const m21 = this.ReadSingle();
        const m22 = this.ReadSingle();
        const m23 = this.ReadSingle();
        const m30 = this.ReadSingle();
        const m31 = this.ReadSingle();
        const m32 = this.ReadSingle();
        const m33 = this.ReadSingle();
        return mat4.fromValues(
            m00, m01, m02, m03,
            m10, m11, m12, m13,
            m20, m21, m22, m23,
            m30, m31, m32, m33,
        );
    }

    public Read7BitEncodedInt(): number {
        let v = 0;
        for (let i = 0; i < 5; i++) {
            const b = this.ReadByte();
            v |= (b & 0x7F) << (i * 7);
            if (!(b & 0x80))
                break;
        }
        return v;
    }

    public ReadString(): string {
        const size = this.Read7BitEncodedInt();
        const str = readString(this.buffer, this.Position, size);
        this.Position += size;
        return str;
    }

    public ReadAsset<T>(): T {
        this.typeReaders = this.ReadTypeReaders();
        const sharedResourceCount = this.Read7BitEncodedInt();
        const obj = assertExists(this.ReadObject<T>());
        this.ReadSharedResources(sharedResourceCount);
        return obj;
    }

    public ReadObject<T>(): T | null {
        const readerIndex = this.Read7BitEncodedInt();
        if (readerIndex === 0)
            return null;
        const typeReader = this.typeReaders[readerIndex - 1];
        return typeReader(this);
    }

    public ReadObjectOrValueType<T>(typeReader: ContentTypeReader): T | null {
        if (this.typeReaderManager.IsValueType(typeReader))
            return typeReader(this);
        else
            return this.ReadObject<T>();
    }

    private ReadTypeReaders(): ContentTypeReader[] {
        const count = this.Read7BitEncodedInt();
        const typeReaders: ContentTypeReader[] = [];
        for (let i = 0; i < count; i++) {
            const typename = this.ReadString();
            const version = this.ReadUInt32();
            assert(version === 0);
            const typeSpec = parseTypeSpec(typename);
            typeReaders.push(this.typeReaderManager.ConstructTypeReaderForTypeSpec(typeSpec));
        }
        return typeReaders;
    }

    private ReadSharedResources(count: number): void {
        assert(count === 0);
    }
}
//#endregion

//#region Built-In Type Readers

//#region System
function XNA_UInt16Reader(reader: ContentReader): number {
    return reader.ReadUInt16();
}

function XNA_UInt32Reader(reader: ContentReader): number {
    return reader.ReadUInt32();
}

function XNA_Int32Reader(reader: ContentReader): number {
    return reader.ReadInt32();
}

function XNA_EnumReader(reader: ContentReader): number {
    return reader.ReadUInt32();
}

function XNA_ArrayReader_Factory(paramsReaders: ContentTypeReader[]): ContentTypeReader {
    return (reader: ContentReader) => {
        const size = reader.ReadInt32();
        return nArray(size, () => reader.ReadObjectOrValueType(paramsReaders[0]));
    };
}

function XNA_DictionaryReader_Factory(paramsReaders: ContentTypeReader[]): ContentTypeReader {
    return (reader: ContentReader) => {
        const size = reader.ReadInt32();
        const map = new Map<any, any>();
        for (let i = 0; i < size; i++) {
            const k = reader.ReadObjectOrValueType(paramsReaders[0]);
            const v = reader.ReadObjectOrValueType(paramsReaders[1]);
            map.set(k, v);
        }
        return map;
    };
}
//#endregion

export const enum XNA_PrimitiveType {
    TriangleList, TriangleStrip, LineList, LineStrip,
}

export const enum XNA_SurfaceFormat {
    Color, Bgr565,
}

export interface XNA_Texture2D {
    format: XNA_SurfaceFormat;
    width: number;
    height: number;
    levelData: ArrayBufferSlice[];
}

function XNA_Texture2DReader(reader: ContentReader): XNA_Texture2D {
    const format = reader.ReadInt32();
    const width = reader.ReadInt32();
    const height = reader.ReadInt32();
    const mipCount = reader.ReadInt32();
    const levelData: ArrayBufferSlice[] = [];
    for (let i = 0; i < mipCount; i++) {
        const size = reader.ReadInt32();
        levelData.push(reader.ReadBytes(size));
    }
    return { format, width, height, levelData };
}

function XNA_MatrixReader(reader: ContentReader): mat4 {
    return reader.ReadMatrix();
}

function XNA_Vector4Reader(reader: ContentReader): vec4 {
    return reader.ReadVector4();
}
//#endregion

//#region Compression
export function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    // This parses & decompresses a raw XNB asset.
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x03) === 'XNB');
    const platform = view.getUint8(0x03);

    // Make sure this is for Windows.
    assert(String.fromCharCode(platform) === 'w');

    const version = view.getUint8(0x04);
    assert(version === 5);

    const flags = view.getUint8(0x05);
    const compressed = !!(flags & 0x80);

    const size = view.getUint32(0x06, true);

    if (compressed) {
        const decompressedSize = view.getUint32(0x0A, true);
        const dst = new Uint8Array(decompressedSize);

        const state = new LZXState(16);
        let idx = 0x0E;
        let dstOffs = 0;
        while (idx < size) {
            const flag = view.getUint8(idx + 0x00);
            let blockSize: number, frameSize: number;
            if (flag === 0xFF) {
                frameSize = view.getUint16(idx + 0x01, false);
                blockSize = view.getUint16(idx + 0x03, false);
                idx += 0x05;
            } else {
                frameSize = 0x8000;
                blockSize = view.getUint16(idx + 0x00, false);
                idx += 0x02;
            }

            if (frameSize === 0 || blockSize === 0)
                break;

            decompressLZX(state, dst, dstOffs, frameSize, buffer.subarray(idx, blockSize));
            idx += blockSize;
            dstOffs += frameSize;
        }

        return new ArrayBufferSlice(dst.buffer);
    } else {
        return buffer.slice(0x0A);
    }
}

export function parse<T>(typeReaderManager: ContentTypeReaderManager, buffer: ArrayBufferSlice): T {
    const reader = new ContentReader(typeReaderManager, decompress(buffer));
    return reader.ReadAsset<T>();
}
//#endregion
