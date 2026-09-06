use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../native/cad-worker/build/Release/kea3d-cad-worker.exe");

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo did not provide OUT_DIR"))
        .join("kea3d-cad-worker.exe");
    let worker = PathBuf::from("../native/cad-worker/build/Release/kea3d-cad-worker.exe");
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
