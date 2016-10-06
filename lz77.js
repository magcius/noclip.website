(function(exports) {
    "use strict";

    // Nintendo DS LZ77 (LZ10) format.

    // Header (8 bytes):
    //   Magic: "LZ77\x10" (5 bytes)
    //   Uncompressed size (3 bytes, little endian)
    // Data:
    //   Flags (1 byte)
    //   For each bit in the flags byte, from MSB to LSB:
    //     If flag is 1:
    //       LZ77 (2 bytes, little endian):
    //         Length: bits 0-3
    //         Offset: bits 4-15
    //         Copy Length+3 bytes from Offset back in the output buffer.
    //     If flag is 0:
    //       Literal: copy one byte from src to dest.

    function assert(b) {
        if (!b) XXX;
    }

    function readString(buffer, offs, length) {
        var buf = new Uint8Array(buffer, offs, length);
        var S = '';
        for (var i = 0; i < length; i++) {
            if (buf[i] === 0)
                break;
            S += String.fromCharCode(buf[i]);
        }
        return S;
    }

    var LZ77 = {};
    LZ77.decompress = function(srcBuffer) {
        var srcView = new DataView(srcBuffer);
        assert(readString(srcBuffer, 0x00, 0x05) == 'LZ77\x10');

        var uncompressedSize = srcView.getUint32(0x04, true) >> 8;
        var dstBuffer = new Uint8Array(uncompressedSize);

        var srcOffs = 0x08;
        var dstOffs = 0x00; 

        while (true) {
            var commandByte = srcView.getUint8(srcOffs++);
            var i = 8;
            while (i--) {
                if (commandByte & (1 << i)) {
                    var tmp = srcView.getUint16(srcOffs, false);
                    srcOffs += 2;

                    var windowOffset = (tmp & 0x0FFF) + 1;
                    var windowLength = (tmp >> 12) + 3;

                    var copyOffs = dstOffs - windowOffset;

                    uncompressedSize -= windowLength;
                    while (windowLength--)
                        dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
                } else {
                    // Literal.
                    uncompressedSize--;
                    dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                }

                if (uncompressedSize <= 0)
                    return dstBuffer.buffer;
            }
        }
    };

    exports.LZ77 = LZ77;

})(window);
