use std::io::Read;
use byteorder::ReadBytesExt;

use crate::halo::common::*;

pub fn read_null_terminated_string_with_size<T: Read>(data: &mut T, len: usize) -> Result<String> {
    let mut str_buf = vec![0; len];
    data.read_exact(&mut str_buf)?;
    let end = str_buf.iter()
        .take_while(|b| **b != 0)
        .count();
    Ok(std::str::from_utf8(&str_buf[0..end]).unwrap().to_string())
}

pub fn read_null_terminated_string<T: Read>(data: &mut T) -> Result<String> {
    let mut res = String::new();
    loop {
        match data.read_u8()? {
            0 => break,
            x => res.push(x as char),
        }
    }
    Ok(res)
}