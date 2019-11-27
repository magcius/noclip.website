
import { PVR_TextureMeta, PVRTFormat, PVRTMask } from "./PVRT";

// Port from https://github.com/yevgeniy-logachev/spvr2png/blob/master/SegaPVRImage.c

class Untwiddle {
    static kTwiddleTableSize = 1024;
    twittleTable = new Uint32Array(Untwiddle.kTwiddleTableSize);

    constructor() {
        this.genTwiddleTable();    
    }

    genTwiddleTable() : void {
        for(let i =0; i < Untwiddle.kTwiddleTableSize; i++) {
            this.twittleTable[i] = this.untwiddleValue( i );
        }
    }

    untwiddleValue(value: number) : number {
        let untwiddled = 0;
    
        for (let i = 0; i < 10; i++) {
            const shift = Math.pow(2, i);
            if (value & shift) {
                untwiddled |= (shift << i);
            }
        }
        
        return untwiddled;
    }

    public getUntwiddledTexelPosition(x: number, y: number) : number {
        let pos = 0;
        
        if(x >= Untwiddle.kTwiddleTableSize || y >= Untwiddle.kTwiddleTableSize) {
            pos = this.untwiddleValue(y) | this.untwiddleValue(x) << 1;
        }
        else {
            pos = this.twittleTable[y] | this.twittleTable[x] << 1;
        }
        
        return pos;
    }
}

function unpackTexelToRGBA(srcTexel: number, srcFormat: PVRTFormat, dst: Uint8Array, dstOffs: number): void
{
    switch( srcFormat )
    {
        case PVRTFormat.RGB565:
        {
            const a = 0xFF;
            const r = (srcTexel & 0xF800) >>> 8;
            const g = (srcTexel & 0x07E0) >>> 3;
            const b = (srcTexel & 0x001F) << 3;

            dst[dstOffs + 0] = r;
            dst[dstOffs + 1] = g;
            dst[dstOffs + 2] = b;
            dst[dstOffs + 3] = a;

            break;
        }
            
        case PVRTFormat.ARGB1555:
        {
            const a = (srcTexel & 0x8000) ? 0xFF : 0x00;
            const r = (srcTexel & 0x7C00) >>> 7;
            const g = (srcTexel & 0x03E0) >>> 2;
            const b = (srcTexel & 0x001F) << 3;

            dst[dstOffs + 0] = r;
            dst[dstOffs + 1] = g;
            dst[dstOffs + 2] = b;
            dst[dstOffs + 3] = a;
            
            break;
        }
            
        case PVRTFormat.ARGB4444:
        {
            const a = (srcTexel & 0xF000) >>> 8;
            const r = (srcTexel & 0x0F00) >>> 4;
            const g = (srcTexel & 0x00F0);
            const b = (srcTexel & 0x000F) << 4;

            dst[dstOffs + 0] = r;
            dst[dstOffs + 1] = g;
            dst[dstOffs + 2] = b;
            dst[dstOffs + 3] = a;
            
            break;
        }
    }
}

function MipMapsCountFromWidth(width: number) : number
{
    let mipMapsCount = 0;
    while( width )
    {
        ++mipMapsCount;
        width /= 2;
    }

    return mipMapsCount;
}

export function decompressPVRT(srcData: DataView, meta: PVR_TextureMeta, width: number, height: number): Uint8Array {

    // size of rgba output
    let dstData = new Uint8Array(width * height * 4);

    let untwiddler = new Untwiddle();

    const kSrcStride = 2;
    const kDstStride = 4;
    
    // Unpack data
    let isTwiddled = false;
    let isMipMaps = false;
    let isVQCompressed = false;
    let codeBookSize = 0;
    
    switch(meta.mask)
    {
        case PVRTMask.TwiddledMipMaps:
            isMipMaps = true;
            isTwiddled = true;
            break;

        case PVRTMask.Twiddled:
            isTwiddled = true;
            break;
          
        case PVRTMask.VectorQuantizedMipMaps:
            isMipMaps = true;
            isVQCompressed = true;
            codeBookSize = 256;
            break;

         case PVRTMask.VectorQuantized:
            isVQCompressed = true;
            codeBookSize = 256;
            break;
            
        default:
            throw "Unhandled mask";
    }

    let srcDataOffset = 0;
    let vqDataOffset = 0;
    
    const numCodedComponents = 4;
    if (isVQCompressed)
    {
        vqDataOffset = 0;
        srcDataOffset += 4 * kSrcStride * codeBookSize;
    }
    
    let mipWidth = 0;
    let mipHeight = 0;
    let mipSize = 0;

    // skip mipmaps - todo: keep all texture levels
    let mipMapCount = (isMipMaps) ? MipMapsCountFromWidth(width) : 1;
    while (mipMapCount)
    {
        mipWidth = (width >> (mipMapCount - 1));
        mipHeight = (height >> (mipMapCount - 1));
        mipSize = mipWidth * mipHeight;
        
        if (--mipMapCount > 0)
        {
            if (isVQCompressed)
            {
                srcDataOffset += Math.floor(mipSize / 4);
            }
            else
            {
                srcDataOffset += kSrcStride * mipSize;
            }
        }
        else if (isMipMaps)
        {
            srcDataOffset += (isVQCompressed) ? 1 : kSrcStride;  // skip 1x1 mip
        }
    }

    // Compressed textures processes only half-size
    if (isVQCompressed)
    {
        mipWidth /= 2;
        mipHeight /= 2;
        mipSize = mipWidth * mipHeight;
    }
    
    //extract image data
    let x = 0;
    let y = 0;
    
    let proccessed = 0;
    while(proccessed < mipSize)
    {
        if (isVQCompressed)
        {
            const codebookIndex = untwiddler.getUntwiddledTexelPosition(x, y);

            // Index of codebook * numbers of 2x2 block components
            let vqIndex = srcData.getUint8(srcDataOffset + codebookIndex) * numCodedComponents;

            // Bypass elements in 2x2 block
            for (let yoffset = 0; yoffset < 2; ++yoffset)
            {
                for (let xoffset = 0; xoffset < 2; ++xoffset)
                {   
                    const srcPos = (vqIndex + (xoffset * 2 + yoffset)) * kSrcStride;
                    const srcTexel = srcData.getUint16(vqDataOffset + srcPos, true);
                                    
                    const dstPos = ((y * 2 + yoffset) * 2 * mipWidth + (x * 2 + xoffset)) * kDstStride;

                    unpackTexelToRGBA(srcTexel, meta.format, dstData, dstPos);
                }
            }

            if (++x >= mipWidth)
            {
                x = 0;
                ++y;
            }
        }
        else
        {
            x = proccessed % mipWidth;
            y = Math.floor(proccessed / mipWidth);
            
            const srcPos = ((isTwiddled) ? untwiddler.getUntwiddledTexelPosition(x, y) : proccessed) * kSrcStride;
            const srcTexel = srcData.getUint16(srcDataOffset + srcPos, true);
            const dstPos = proccessed * kDstStride;

            unpackTexelToRGBA(srcTexel, meta.format, dstData, dstPos);
        }
        
        ++proccessed;
    }

    return dstData;
}
