use lazy_static::lazy_static;
use serde::Deserialize;
use std::env;

#[derive(Deserialize)]
pub struct CargoConfig {
    package: CargoPackage,
}

#[derive(Deserialize)]
pub struct CargoPackage {
    version: String,
}

pub struct Config {
    pub version: String,
    pub hostname: String,
    pub port: u16,
    pub s3_audio_url: String,
    pub s3_subs_url: String,
    pub user_agent: String,
}

lazy_static! {
    static ref CARGO_CONFIG: CargoConfig =
        toml::from_str(include_str!("../../Cargo.toml")).unwrap();
    pub static ref CONFIG: Config = Config {
        version: CARGO_CONFIG.package.version.clone(),
        hostname: match env::var("SERVICE_HOST") {
            Ok(host) => host,
            Err(_) => "127.0.0.1".to_string(),
        },
        port: match env::var("SERVICE_PORT") {
            Ok(port) => port.parse().unwrap(),
            Err(_) => 7674,
        },
        s3_audio_url: "vtrans.s3-private.mds.yandex.net/tts/prod/".to_string(),
        s3_subs_url: "brosubs.s3-private.mds.yandex.net/vtrans/".to_string(),
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 YaBrowser/25.4.0.0 Safari/537.36".to_string()
    };
}
