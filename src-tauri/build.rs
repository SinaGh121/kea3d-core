use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../dist");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let worker = if target_os == "windows" {
        PathBuf::from("../native/cad-worker/build/Release/kea3d-cad-worker.exe")
    } else if target_os == "linux" {
        PathBuf::from("../native/cad-worker/build-linux/kea3d-cad-worker")
    } else {
        PathBuf::from("../native/cad-worker/build/kea3d-cad-worker-unavailable")
    };
    println!("cargo:rerun-if-changed={}", worker.display());

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo did not provide OUT_DIR"))
        .join("kea3d-cad-worker");
    if worker.is_file() {
        fs::copy(&worker, &output).expect("Could not embed the native CAD worker");
    } else {
        fs::write(&output, []).expect("Could not create the native CAD worker placeholder");
        println!(
            "cargo:warning=Native CAD worker is unavailable; large STEP fallback will be disabled"
        );
    }
    tauri_build::build()
}
