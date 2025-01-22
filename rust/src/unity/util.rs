use deku::prelude::*;
use std::fmt::Debug;

pub fn deku_peek<'a, T, R: deku::no_std_io::Read + deku::no_std_io::Seek>(reader: &mut Reader<R>, msg: &str) -> Result<T, DekuError>
    where for<'b> T: DekuReader<'b, ()> + Debug
{
    println!("deku_peek - {}", msg);
    println!("  offset: {}", reader.bits_read);
    match T::from_reader_with_ctx(reader, ()) {
        Ok(value) => {
            println!("  value: {:?}", value);
            Ok(value)
        }
        Err(err) => {
            println!("  ERROR: {:?}", err);
            Err(err)
        }
    }
}
