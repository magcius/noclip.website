#[cfg(test)]
pub fn readfile(p: &str) -> Vec<u8> {
    let base_path = std::path::Path::new("../data/CrazyTaxi/files/ct/");
    std::fs::read( base_path.join(p)).unwrap()
}

#[cfg(test)]
pub fn readextract(p: &str) -> Vec<u8> {
    let base_path = std::path::Path::new("./ct-extract");
    std::fs::read( base_path.join(p)).unwrap()
}
