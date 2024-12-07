use deku::{bitvec::{BitSlice, Msb0}, prelude::*};
use std::fmt::Debug;

pub fn deku_peek<'a, T>(input: &'a BitSlice<u8, Msb0>, byte_offset: usize, msg: &str) -> Result<(&'a BitSlice<u8, Msb0>, T), DekuError>
    where for<'b> T: DekuRead<'b, ()> + Debug
{
    println!("deku_peek - {}", msg);
    println!("  offset: {}", byte_offset);
    match T::read(input, ()) {
        Ok((rest, value)) => {
            println!("  value: {:?}", value);
            Ok((rest, value))
        }
        Err(err) => {
            println!("  ERROR: {:?}", err);
            Err(err)
        }
    }
}
