import ArrayBufferSlice from "../../ArrayBufferSlice";

// https://github.com/niemasd/PyFF7/wiki/LZSS-Format
// Section2
// https://github.com/cebix/ff7tools/blob/master/ff7/lzss.py

export function decompress(srcView: DataView, uncompressedSize: number) {
    let dataSize = srcView.byteLength;
    const dstBuffer = new Uint8Array(uncompressedSize);

    const MIN_REF_LEN = 3;
    
    let dstPos = 0;
    let i = 0;
    let j = 0;

    while(i < dataSize){
        const commandByte = srcView.getUint8(i);
        i++;
        
        for (let bit = 0; bit < 8; bit++){
            if(i >= dataSize){
                break;
            }

            if(commandByte & ( 1 << bit)){
                dstBuffer[dstPos] = srcView.getUint8(i);
                dstPos++;
                i++;
                j++;
            } else {
                let offset = srcView.getUint8(i) | ((srcView.getUint8(i+1) & 0xF0) << 4);
                let length = (srcView.getUint8(i+1) & 0x0F) + MIN_REF_LEN;
                i+=2;
                
                let ref = j - ((j + 0xFEE - offset) & 0xFFF);
                while(length > 0){
                    if(ref < 0){
                        dstBuffer[dstPos] = 0x00;
                        dstPos++;
                    } else {
                        dstBuffer[dstPos] = dstBuffer[ref];
                        dstPos++;
                    }

                    j++;
                    ref++;
                    length--;
                }
            }
        }
    }
    return new ArrayBufferSlice(dstBuffer.buffer);
}