
use wasm_bindgen::prelude::wasm_bindgen;
use web_sys::console;
use std::error::Error;

fn show_error(place: &str, error: impl Error) {
    console::log_2(&place.into(), &error.to_string().into());

    let mut e = error.source();
    while let Some(source) = e {
        console::log_1(&source.to_string().into());
        e = source.source();
    }
}

#[wasm_bindgen]
pub fn glsl_compile(source: &str, stage: &str, validation_enabled: bool) -> String {
    let naga_stage = match stage {
        "vertex" => Ok(naga::ShaderStage::Vertex),
        "fragment" => Ok(naga::ShaderStage::Fragment),
        "compute" => Ok(naga::ShaderStage::Compute),
        _ => Err("unknown shader stage")
    }.unwrap();

    let mut parser = naga::front::glsl::Parser::default();
    let module = match parser.parse(&naga::front::glsl::Options {
        stage: naga_stage,
        defines: Default::default(),
    }, &source) {
        Ok(v) => v,
        Err(errors) => {
            for e in errors {
                show_error(&"glsl::parse_str", e);
            }

            panic!();
        },
    };

    let validation_flags = if validation_enabled { naga::valid::ValidationFlags::all() } else { naga::valid::ValidationFlags::empty() };
    let info = match naga::valid::Validator::new(validation_flags, naga::valid::Capabilities::all()).validate(&module) {
        Ok(v) => v,
        Err(e) => {
            show_error(&"validator", e);
            panic!();
        }
    };

    let writer_flags = naga::back::wgsl::WriterFlags::all();
    match naga::back::wgsl::write_string(&module, &info, writer_flags) {
        Ok(v) => v,
        Err(e) => {
            show_error(&"wgsl::write_string", e);
            panic!();
        }
    }
}
