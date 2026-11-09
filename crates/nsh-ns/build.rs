use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=c");
    cc::Build::new()
        .files(["c/quickjs-api.c", "c/baton.c"])
        .include("c")
        .include("c/qjs")
        .define("__QJS_NG__", None)
        .define("NAPI_VERSION", "9")
        .define("NDEBUG", None)
        .flag("-std=gnu11")
        .flag("-Wno-everything")
        .cargo_metadata(false)
        .compile("nsh_ns_bridge");

    let lib = PathBuf::from(env::var("OUT_DIR").unwrap()).join("libnsh_ns_bridge.a");
    // NativeScript.framework resolves napi_* against the host process at load
    // time, so every symbol must be kept and exported from the executable.
    println!("cargo:rustc-link-arg-bins=-Wl,-force_load,{}", lib.display());
    println!("cargo:rustc-link-arg-bins=-Wl,-export_dynamic");
    println!("cargo:rustc-link-arg-bins=-framework");
    println!("cargo:rustc-link-arg-bins=CoreFoundation");
}
