
use wasm_bindgen::prelude::*;
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
pub fn glsl_compile(source: &str, stage: &str) -> String {
    let naga_stage = match stage {
        "vertex" => Ok(naga::ShaderStage::Vertex),
        "fragment" => Ok(naga::ShaderStage::Fragment),
        _ => Err("unknown shader stage")
    }.unwrap();

    let mut entry_points = naga::FastHashMap::default();
    entry_points.insert("main".to_string(), naga_stage);

    let module = match naga::front::glsl::parse_str(source, &naga::front::glsl::Options {
        entry_points,
        defines: Default::default(),
    }) {
        Ok(v) => v,
        Err(e) => {
            show_error(&"glsl::parse_str", e);
            panic!();
        },
    };

    let info = match naga::valid::Validator::new(naga::valid::ValidationFlags::empty(), naga::valid::Capabilities::all()).validate(&module) {
        Ok(v) => v,
        Err(e) => {
            show_error(&"validator", e);
            panic!();
        }
    };

    match naga::back::wgsl::write_string(&module, &info) {
        Ok(v) => v,
        Err(e) => {
            show_error(&"wgsl::write_string", e);
            panic!();
        }
    }
}
