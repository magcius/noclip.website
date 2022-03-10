import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";

export var decompress = function (buffer: ArrayBufferSlice, srcOffs: number = 0) : ArrayBufferSlice {
    const view = buffer.createDataView();
    assert(view.getUint32(srcOffs + 0x00) === 0x464c4132); // "FLA2"

    const uncompressed_length = view.getUint32(srcOffs + 0x04, true)
    let uncompressed_data = new Uint8Array(uncompressed_length);
    let bytes_written = 0;

    let window = new Uint8Array(0x1000);
    let window_cursor = 0;

    const data = buffer.createTypedArray(Uint8Array, srcOffs + 0x08);
    let data_cursor = 0;

    while(bytes_written < uncompressed_length) {
        const cmd_chunk = data[data_cursor];
        data_cursor += 1;
        for (let i = 0; i < 8; i++) {
            const cmd = cmd_chunk & (0x80 >> i);

            if (cmd == 0) {
                // New data
                uncompressed_data[bytes_written] = data[data_cursor];
                window[window_cursor] = data[data_cursor];

                data_cursor += 1;
                bytes_written += 1;
                window_cursor = (window_cursor + 1) & 0xFFF;
            } else {
                // Backreference

                if (data[data_cursor] == 0 && data[data_cursor + 1] == 0) {
                    assert(uncompressed_length == bytes_written);
                    return new ArrayBufferSlice(uncompressed_data.buffer);
                }

                const backref_len = (data[data_cursor] & 0x0F) + 2;
                const backref_dist = ((data[data_cursor] & 0xF0) << 4) + data[data_cursor + 1];
                data_cursor += 2;

                let backref_start = window_cursor - backref_dist;
                let backref_end = backref_start + backref_len;

                for (let backref_cursor = backref_start;
                     backref_cursor < backref_end;
                     backref_cursor++)
                {
                    let next_byte = window[backref_cursor & 0xFFF];

                    window[window_cursor] = next_byte;
                    window_cursor = (window_cursor + 1) & 0xFFF;

                    uncompressed_data[bytes_written] = next_byte;
                    bytes_written += 1;
                }
            }
        }
    }

    assert(uncompressed_length == bytes_written);
    return new ArrayBufferSlice(uncompressed_data.buffer)
}

