//! `libnsh.so` with NativeScript installed in the app's own VM.
//!
//! Replaces the library `nsh-platform-android` builds on its own, so its JNI
//! entry points are reachable through this dependency.

use std::ffi::c_void;

use jni::{
    JNIEnv,
    objects::JClass,
};
use nsh_core::prelude::*;

type Task = extern "C" fn(*mut c_void);

#[module]
pub struct Bench;

#[module]
impl Bench {
    pub fn noop() -> i32 {
        0
    }

    pub fn pid() -> i32 {
        // SAFETY: bound before any engine starts.
        unsafe { nsh_android_bench_pid() }
    }

    pub fn pid_on_main_fast() -> i32 {
        extern "C" fn read_pid(arg: *mut c_void) {
            // SAFETY: `arg` is the `pid` below, alive until the hand-off returns.
            unsafe { *arg.cast::<i32>() = nsh_android_bench_pid() };
        }
        let mut pid = 0;
        // SAFETY: called on the engine thread; the bridge returns once it ran.
        unsafe { nsh_run_on_main(read_pid, (&raw mut pid).cast()) };
        pid
    }

    pub fn pid_on_main() -> i32 {
        // SAFETY: as above.
        unsafe { nsh_android_bench_pid_on_main() }
    }
}

#[native_module("ns-bench/native")]
fn native(registry: &mut Registry) {
    registry.module::<Bench>();
}

unsafe extern "C" {
    fn nsh_run_on_main(task: extern "C" fn(*mut c_void), arg: *mut c_void);
    fn nsh_android_bench_pid() -> i32;
    fn nsh_android_bench_pid_on_main() -> i32;
    fn nsh_android_bind_main(env: *mut c_void, bridge: *mut c_void);
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

fn install_nativescript(context: *mut c_void) {
    // SAFETY: called on the engine thread with the VM's live context.
    unsafe { nsh_ns_attach(context, std::ptr::null()) };
}

/// Called on the main thread before the first `NshView` starts.
#[unsafe(no_mangle)]
extern "system" fn Java_dev_nstudio_nshns_NsBridge_install(env: JNIEnv<'_>, bridge: JClass<'_>) {
    // SAFETY: both are valid for this call, and the main thread has a Looper.
    unsafe { nsh_android_bind_main(env.get_raw().cast(), bridge.as_raw().cast()) };
    nsh::set_ui_sets(vec![nsh_base::registry(), registry()]);
    nsh_js::set_context_hook(install_nativescript);
}
