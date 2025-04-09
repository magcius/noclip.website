use std::convert::TryFrom;

#[derive(Debug, PartialEq, PartialOrd, Default, Copy, Clone)]
pub struct ParsedUnityVersion {
    pub major: usize,
    pub minor: usize,
    pub build: usize,
    pub version_type: VersionType,
    pub type_number: usize,
}

#[derive(Debug, PartialEq, Clone)]
pub enum VersionParseError {
    InvalidString(String),
}

impl TryFrom<&str> for ParsedUnityVersion {
    type Error = VersionParseError;
    fn try_from(s: &str) -> std::result::Result<Self, VersionParseError> {
        let err = VersionParseError::InvalidString(s.to_string());
        let parts: Vec<&str> = s.split(|c| c == '.' || "abcfpe".contains(c))
            .collect();
        let numbers: Vec<usize> = parts.iter()
            .map(|num| num.parse::<usize>())
            .flatten()
            .collect();
        match numbers.len() {
            3 => {
                Ok(ParsedUnityVersion {
                    major: numbers[0],
                    minor: numbers[1],
                    build: numbers[2],
                    ..Default::default()
                })
            },
            4 => {
                let version_type = match s.find(char::is_alphabetic) {
                    Some(i) => match s.chars().nth(i) {
                        Some('a') => VersionType::Alpha,
                        Some('b') => VersionType::Beta,
                        Some('c') => VersionType::China,
                        Some('f') => VersionType::Final,
                        Some('p') => VersionType::Patch,
                        Some('e') => VersionType::Experimental,
                        _ => return Err(err),
                    },
                    None => return Err(err),
                };
                Ok(ParsedUnityVersion {
                    major: numbers[0],
                    minor: numbers[1],
                    build: numbers[2],
                    version_type,
                    type_number: numbers[3],
                })
            },
            _ => Err(err),
        }
    }
}

#[derive(Debug, PartialEq, PartialOrd, Copy, Clone)]
pub enum VersionType {
    Alpha,
    Beta,
    China,
    Final,
    Patch,
    Experimental,
}

impl Default for VersionType {
    fn default() -> Self { VersionType::Final }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_construction() {
        assert_eq!(ParsedUnityVersion::try_from("2020.3.21p1"), Ok(ParsedUnityVersion {
            major: 2020,
            minor: 3,
            build: 21,
            version_type: VersionType::Patch,
            type_number: 1,
        }));
        assert_eq!(ParsedUnityVersion::try_from("3.5.3"), Ok(ParsedUnityVersion {
            major: 3,
            minor: 5,
            build: 3,
            version_type: VersionType::Final,
            type_number: 0,
        }));
    }

    #[test]
    fn test_compare() {
        let v1 = ParsedUnityVersion::try_from("2020.3.21.f1").unwrap();
        let v2 = ParsedUnityVersion::try_from("2020.3.20.f1").unwrap();
        let v3 = ParsedUnityVersion::try_from("3.5.20").unwrap();
        assert_eq!(v1 >= v2, true);
        assert_eq!(v1 >= v3, true);
        assert_eq!(v2 >= v3, true);
    }
}
