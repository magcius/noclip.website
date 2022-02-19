pub struct BitStream<'a> {
    data: &'a [u8],
    num_items: usize,
    bit_size: usize,
}

impl<'a> BitStream<'a> {
    pub fn new(data: &[u8], num_items: usize, bit_size: usize) -> BitStream {
        BitStream { data, num_items, bit_size }
    }

    pub fn unpack_f32(&'a self, start: f32, range: f32) -> Vec<f32> {
        let mut scale = range;
        scale /= ((1 << self.bit_size) as f32) - 1.0;
        self.unpack_i32().iter().map(|&n| start + (n as f32) * scale).collect()
    }

    pub fn unpack_i32(&'a self) -> Vec<i32> {
        let mut result: Vec<i32> = Vec::with_capacity(self.num_items);
        let mut index_pos = 0;
        let mut bit_pos = 0;
        let bit_mask = (1 << self.bit_size) - 1;
        for i in 0..self.num_items {
            let mut bits = 0;
            result.push(0);
            while bits < self.bit_size {
                result[i] |= (self.data[index_pos] as i32 >> bit_pos) << bits;
                let num = std::cmp::min(self.bit_size - bits, 8 - bit_pos);
                bit_pos += num;
                bits += num;
                if bit_pos == 8 {
                    index_pos += 1;
                    bit_pos = 0;
                }
            }
            result[i] &= bit_mask;
        }
        result
    }

    pub fn octohedral_unpack(&'a self, start: f32, range: f32, sign_stream: &'_ BitStream) -> Vec<f32> {
        let xy = self.unpack_f32(start, range);
        let signs = sign_stream.unpack_i32();
        let n = xy.len() / 2;
        let mut result = vec![0.0; 3 * n];
        for i in 0..n {
            let x = xy[2*i];
            let y = xy[2*i + 1];
            result[3*i + 0] = x;
            result[3*i + 1] = y;
            let zsqr = 1.0 - x*x - y*y;
            if zsqr >= 0.0 {
                result[3*i + 2] = zsqr.sqrt();
            } else {
                result[3*i + 2] = 0.0;
            }

            if signs.len() > 0 && signs[i] == 0 {
                result[3*i + 2] *= -1.0;
            }
        }
        result
    }
}