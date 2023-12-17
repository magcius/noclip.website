
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, align, decodeString } from "../util.js";

// Dark Souls MTD (Material Data)

export const enum MTDParamType {
    Bool   = "bool",
    Float  = "float",
    Float2 = "float2",
    Float3 = "float3",
    Float4 = "float4",
    Int    = "int",
    Int2   = "int2",
}

export interface MTDParam {
    name: string;
    type: MTDParamType;
    value: number[];
}

export interface MTDTexture {
    name: string;
    uvNumber: number;
    shaderDataIndex: number;
}

export interface MTD {
    shaderPath: string;
    description: string;
    params: MTDParam[];
    textures: MTDTexture[];
}

const enum DataType {
    Chunk = 0x01,
    ChunkArray = 0x03,
    ChunkOptional = 0x04,
    U32 = 0x34,
    S32 = 0x35,
    String = 0xA3,
    FileMagic = 0xB0,
    F32Array0 = 0xBA,
    BoolArray = 0xC0,
    U32Array = 0xC5,
    F32Array = 0xCA,
}

type DataTypeRet<T extends DataType> =
    T extends DataType.U32 ? number :
    T extends DataType.S32 ? number :
    T extends DataType.String ? string :
    T extends DataType.FileMagic ? string :
    never;

class DataReader {
    private view: DataView;
    public offs: number = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    private align4() { this.offs = align(this.offs, 4); }

    public assertChunk(expectedID: number, expectedCount: number | null, expectType: boolean): number {
        if (expectType)
            assert(this.readUint8() === DataType.Chunk);

        assert(this.readUint32() === 0x00);
        const length = this.readUint32();
        const type = this.readUint32();
        assert(type === expectedID);
        const count = this.readUint32();
        if (expectedCount !== null)
            assert(count === expectedCount);
        return count;
    }

    public readUint8(): number {
        return this.view.getUint8(this.offs++);
    }

    public readUint32(): number {
        this.align4();
        const n = this.view.getUint32(this.offs + 0x00, true);
        this.offs += 0x04;
        return n;
    }

    public readInt32(): number {
        this.align4();
        const n = this.view.getInt32(this.offs + 0x00, true);
        this.offs += 0x04;
        return n;
    }

    public readFloat32(): number {
        this.align4();
        const n = this.view.getFloat32(this.offs + 0x00, true);
        this.offs += 0x04;
        return n;
    }

    private readString(): string {
        this.align4();
        const size = this.view.getUint32(this.offs + 0x00, true);
        const str = decodeString(this.buffer, this.offs + 0x04, size, 'sjis');
        this.offs += 0x04 + size;
        return str;
    }

    public assertUint8(v: number): void {
        assert(this.readUint8() === v);
    }

    public assertType(type: DataType): void {
        this.assertUint8(type);
    }

    public assertUint32(v: number): void {
        assert(this.readUint32() === v);
    }

    public readChunkArray(): number {
        this.assertType(DataType.ChunkArray);
        const num = this.readUint32();
        return num;
    }

    public readChunkOptional(): boolean {
        this.assertType(DataType.ChunkOptional);
        const hasData = this.readUint32();
        assert(hasData === 0 || hasData === 1);
        return !!hasData;
    }

    public readTypedData<T extends DataType>(expectedType: T): DataTypeRet<T> {
        const type = this.readUint8();
        assert(type === expectedType);

        if (type === DataType.U32) {
            return this.readUint32() as DataTypeRet<T>;
        } else if (type === DataType.S32) {
            return this.readInt32() as DataTypeRet<T>;
        } else if (type === DataType.String) {
            return this.readString() as DataTypeRet<T>;
        } else if (type === DataType.FileMagic) {
            const val = this.readString();
            assert(val.length === 4);
            return val as DataTypeRet<T>;
        } else {
            throw "whoops";
        }
    }
}

const enum MTDChunkID {
    Root = 0,
    FileInfo = 1,
    Material = 2,
    MaterialData = 3,
    Param = 4,
    ParamBool = 0x1000,
    ParamU32  = 0x1001,
    ParamF32  = 0x1002,
    Texture   = 0x2000,
}

export function parse(buffer: ArrayBufferSlice): MTD {
    const reader = new DataReader(buffer);

    reader.assertChunk(MTDChunkID.Root, 3, false); // Root chunk
    reader.assertChunk(MTDChunkID.FileInfo, 2, true);

    assert(reader.readTypedData(DataType.FileMagic) === 'MTD ');
    assert(reader.readTypedData(DataType.U32) === 1000); // Version

    reader.assertChunk(MTDChunkID.Material, 4, true); // Material chunk header

    const shaderPath = reader.readTypedData(DataType.String);
    const description = reader.readTypedData(DataType.String);

    assert(reader.readChunkArray() === 1);
    reader.assertChunk(MTDChunkID.MaterialData, 4, false);
    reader.readTypedData(DataType.String); // Name

    const paramCount = reader.readChunkArray();
    const params: MTDParam[] = [];
    for (let i = 0; i < paramCount; i++) {
        reader.assertChunk(4, 4, false); // Param
        const name = reader.readTypedData(DataType.String);
        const type = reader.readTypedData(DataType.String) as MTDParamType;

        assert(reader.readChunkOptional());

        let value: number[] = [];
        if (type === MTDParamType.Int) {
            reader.assertChunk(MTDChunkID.ParamU32, 1, false);
            reader.assertType(DataType.U32Array);
            reader.assertUint32(1);
            value.push(reader.readUint32());
        } else if (type === MTDParamType.Int2) {
            reader.assertChunk(MTDChunkID.ParamU32, 1, false);
            reader.assertType(DataType.U32Array);
            reader.assertUint32(2);
            value.push(reader.readUint32());
            value.push(reader.readUint32());
        } else if (type === MTDParamType.Bool) {
            reader.assertChunk(MTDChunkID.ParamBool, 1, false);
            reader.assertType(DataType.BoolArray);
            reader.assertUint32(1);
            value.push(reader.readUint8());
        } else if (type === MTDParamType.Float) {
            reader.assertChunk(MTDChunkID.ParamF32, 1, false);
            reader.assertType(DataType.F32Array);
            reader.assertUint32(1);
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float2) {
            reader.assertChunk(MTDChunkID.ParamF32, 1, false);
            reader.assertType(DataType.F32Array);
            reader.assertUint32(2);
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float3) {
            reader.assertChunk(MTDChunkID.ParamF32, 1, false);
            reader.assertType(DataType.F32Array);
            reader.assertUint32(3);
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float4) {
            reader.assertChunk(MTDChunkID.ParamF32, 1, false);
            reader.assertType(DataType.F32Array);
            reader.assertUint32(4);
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else {
            throw "whoops";
        }

        assert(!reader.readChunkOptional());

        params.push({ name, type, value });
    }

    const textureCount = reader.readChunkArray();
    const textures: MTDTexture[] = [];
    const uvNumberMap = new Map<number, number>();
    for (let i = 0; i < textureCount; i++) {
        const count = reader.assertChunk(MTDChunkID.Texture, null, false);
        assert(count === 3 || count === 5);

        const name = reader.readTypedData(DataType.String);
        const uvNumber_ = reader.readTypedData(DataType.S32);
        assert(uvNumber_ >= 0);
        const shaderDataIndex = reader.readTypedData(DataType.S32);

        let uvNumber = uvNumberMap.get(uvNumber_);
        if (uvNumber === undefined) {
            uvNumber = uvNumberMap.size;
            uvNumberMap.set(uvNumber_, uvNumber);
        }

        if (count === 5) {
            const path = reader.readTypedData(DataType.String);

            reader.assertUint8(DataType.F32Array0);
            const floatCount = reader.readUint32();
            for (let j = 0; j < floatCount; j++)
                reader.readFloat32();
        }

        textures.push({ name, uvNumber, shaderDataIndex });
    }

    assert(!reader.readChunkOptional());

    return { shaderPath, description, params, textures };
}
