use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=../nsh-ns/c");
    println!("cargo:rerun-if-changed=android-imports.txt");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android") {
        return;
    }
    cc::Build::new()
        .files(["../nsh-ns/c/quickjs-api.c", "../nsh-ns/c/baton.c"])
        .include("../nsh-ns/c")
        .include("../nsh-ns/c/qjs")
        .define("__QJS_NG__", None)
        .define("NAPI_VERSION", "9")
        .define("NDEBUG", None)
        .flag("-std=gnu11")
        .flag("-Wno-everything")
        .cargo_metadata(false)
        .compile("nsh_ns_bridge");

    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let imports = fs::read_to_string("android-imports.txt").unwrap();
    let names: Vec<&str> = imports.lines().filter(|l| !l.is_empty()).collect();
    let script = out.join("exports.map");
    fs::write(&script, format!("{{ global: {}; }};\n", names.join("; "))).unwrap();

    let lib = out.join("libnsh_ns_bridge.a");
    // libNativeScript.so binds napi_* and the engine against this library at
    // load time, so they are kept and exported rather than hidden as a cdylib's
    // symbols normally are.
    println!("cargo:rustc-link-arg-cdylib=-Wl,--whole-archive,{},--no-whole-archive", lib.display());
    println!("cargo:rustc-link-arg-cdylib=-Wl,--version-script={}", script.display());
    println!("cargo:rustc-link-arg-cdylib=-Wl,-z,max-page-size=16384");
    println!("cargo:rustc-link-arg-cdylib=-landroid");
    // NshView loads this library as libnsh.so.
    println!("cargo:rustc-link-arg-cdylib=-Wl,-soname,libnsh.so");
}
