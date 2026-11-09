//! Runs an nsh bundle with NativeScript installed in the app's own VM.
//!
//! macOS: `nsh-ns <bundle.js>`. iOS: runs `nsh/bundle.js` from the app bundle.
//! `NSH_NS_HARDEN` applies nsh's production hardening; `NSH_NS_FRAMEWORK`
//! overrides where the NativeScript framework binary is loaded from.

mod bench;
mod host_view;

use std::{
    ffi::{CString, c_void},
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use nsh_core::prelude::{Registry, native_module};
use nsh_engine::{Bundle, Policy};

#[native_module("ns-bench/native")]
fn native(registry: &mut Registry) {
    registry.module::<bench::Bench>();
}

type Task = extern "C" fn(*mut c_void);

unsafe extern "C" {
    fn nsh_ns_attach(context: *mut c_void, framework_path: *const std::ffi::c_char);
}

#[derive(Clone, Copy)]
struct SendPointer(*mut c_void);
// SAFETY: the pointer is only dereferenced by the task it was queued with.
unsafe impl Send for SendPointer {}

impl SendPointer {
    fn get(self) -> *mut c_void {
        self.0
    }
}

#[unsafe(no_mangle)]
extern "C" fn nsh_post_to_engine(task: Task, arg: *mut c_void) -> bool {
    let arg = SendPointer(arg);
    nsh_engine::run_on_engine(Box::new(move || task(arg.get())))
}

#[cfg(target_os = "macos")]
fn default_framework() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../rt/macos-node-api/package/build/RelWithDebInfo/NativeScript.apple.node/",
        "macos-arm64/NativeScript.framework/Versions/A/NativeScript"
    ))
}

#[cfg(target_os = "ios")]
fn default_framework() -> PathBuf {
    app_dir().join("Frameworks/NativeScript.framework/NativeScript")
}

#[cfg(target_os = "ios")]
fn app_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_default()
}

/// NativeScript binds to one VM for the life of the process, and native code
/// the old app started keeps running, so a from-scratch reload needs a new
/// process.
fn restart_for_new_vm() -> ! {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        let exe = std::env::current_exe().expect("a path to the running binary");
        let err = std::process::Command::new(exe)
            .args(std::env::args_os().skip(1))
            .exec();
        eprintln!("cannot restart: {err}");
    }
    #[cfg(target_os = "ios")]
    eprintln!("nsh-ns: a full reload needs the app to be relaunched");
    std::process::exit(0)
}

fn install_nativescript(context: *mut c_void) {
    static ATTACHED: AtomicBool = AtomicBool::new(false);
    if ATTACHED.swap(true, Ordering::Relaxed) {
        restart_for_new_vm();
    }
    let path = std::env::var_os("NSH_NS_FRAMEWORK")
        .map(PathBuf::from)
        .unwrap_or_else(default_framework);
    let path = CString::new(path.as_os_str().as_bytes()).expect("a path without NUL bytes");
    // SAFETY: called on the engine thread with the VM's live context.
    unsafe { nsh_ns_attach(context, path.as_ptr()) };
}

fn read_bundle(path: &Path) -> Result<Bundle, String> {
    let bundle = Bundle::read(path).map_err(|err| format!("cannot read {}: {err}", path.display()))?;
    let policy = if std::env::var_os("NSH_NS_HARDEN").is_some() {
        Policy::default()
    } else {
        Policy::development()
    };
    Ok(bundle.with_policy(policy))
}

#[cfg(target_os = "macos")]
fn macos_source(path: &Path) -> Result<nsh_platform_macos::AppSource, String> {
    #[cfg(feature = "dev")]
    if let Some(url) = path.to_str().filter(|arg| arg.starts_with("ws://")) {
        return Ok(nsh_platform_macos::AppSource::DevServer(url.to_owned()));
    }
    read_bundle(path).map(nsh_platform_macos::AppSource::Bundle)
}

#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    use nsh_platform_macos::{AppOptions, run_app, set_components, set_ui_sets};

    env_logger::init();
    let Some(path) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: nsh-ns <bundle.js | ws://dev-server/ws>");
        return std::process::ExitCode::FAILURE;
    };
    let source = match macos_source(&path) {
        Ok(source) => source,
        Err(err) => {
            eprintln!("{err}");
            return std::process::ExitCode::FAILURE;
        }
    };
    set_ui_sets(vec![nsh_base::registry(), registry()]);
    set_components(host_view::register);
    if std::env::var_os("NSH_NS_OFF").is_none() {
        nsh_js::set_context_hook(install_nativescript);
    }
    let options = AppOptions {
        title: "NativeScript in nsh".into(),
        background: std::env::var_os("NSH_NS_BACKGROUND").is_some(),
        ..AppOptions::default()
    };
    run_app(source, options)
}

#[cfg(target_os = "ios")]
fn ios_source() -> Result<nsh_platform_ios::AppSource, String> {
    #[cfg(feature = "dev")]
    if let Ok(url) = std::env::var("NSH_NS_DEV_SERVER") {
        return Ok(nsh_platform_ios::AppSource::DevServer(url));
    }
    read_bundle(&app_dir().join("nsh/bundle.js")).map(nsh_platform_ios::AppSource::Bundle)
}

#[cfg(target_os = "ios")]
fn main() {
    use nsh_platform_ios::{AppOptions, run_app, set_components, set_ui_sets};

    env_logger::init();
    let source = match ios_source() {
        Ok(source) => source,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    };
    set_ui_sets(vec![nsh_base::registry(), registry()]);
    set_components(host_view::register);
    if std::env::var_os("NSH_NS_OFF").is_none() {
        nsh_js::set_context_hook(install_nativescript);
    }
    run_app(source, AppOptions::default());
}
