//! The platform calls TSX reaches through nsh's own module system, for
//! comparison with the same calls through NativeScript.

use std::ffi::c_void;

use nsh_core::prelude::*;
use objc2_foundation::NSProcessInfo;

#[cfg(target_os = "macos")]
mod tray {
    use std::cell::RefCell;

    use objc2::{MainThreadMarker, rc::Retained};
    use objc2_app_kit::{NSAccessibility, NSStatusBar, NSStatusItem, NSVariableStatusItemLength};
    use objc2_foundation::NSString;

    thread_local! {
        static ITEM: RefCell<Option<Retained<NSStatusItem>>> = const { RefCell::new(None) };
    }

    pub(super) fn create() {
        let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
        ITEM.with(|slot| *slot.borrow_mut() = Some(item));
    }

    pub(super) fn update(text: &str) {
        let mtm = MainThreadMarker::new().expect("runs on the main thread");
        ITEM.with(|slot| {
            if let Some(button) = slot.borrow().as_ref().and_then(|item| item.button(mtm)) {
                let text = NSString::from_str(text);
                button.setToolTip(Some(&text));
                button.setAccessibilityLabel(Some(&text));
            }
        });
    }

    pub(super) fn remove() {
        ITEM.with(|slot| {
            if let Some(item) = slot.borrow_mut().take() {
                NSStatusBar::systemStatusBar().removeStatusItem(&item);
            }
        });
    }
}

unsafe extern "C" {
    fn nsh_run_on_main(task: extern "C" fn(*mut c_void), arg: *mut c_void);
}

/// Runs `run` on the main thread through the bridge's spinning hand-off, the
/// route NativeScript calls take.
fn on_main_fast<R>(run: impl FnOnce() -> R) -> R {
    struct Call<F, R> {
        run: Option<F>,
        result: Option<R>,
    }
    extern "C" fn trampoline<F: FnOnce() -> R, R>(arg: *mut c_void) {
        // SAFETY: `arg` is the `Call` below, alive until the hand-off returns.
        let call = unsafe { &mut *arg.cast::<Call<F, R>>() };
        call.result = call.run.take().map(|run| run());
    }
    fn launch<F: FnOnce() -> R, R>(run: F) -> R {
        let mut call = Call { run: Some(run), result: None };
        // SAFETY: called on the engine thread; the bridge returns once it ran.
        unsafe { nsh_run_on_main(trampoline::<F, R>, (&raw mut call).cast()) };
        call.result.expect("the task ran")
    }
    launch(run)
}

#[module]
pub struct Bench;

#[module]
impl Bench {
    pub fn noop() -> i32 {
        0
    }

    pub fn pid() -> i32 {
        NSProcessInfo::processInfo().processIdentifier()
    }

    pub fn os_version() -> String {
        NSProcessInfo::processInfo()
            .operatingSystemVersionString()
            .to_string()
    }

    pub fn tray_create() {
        #[cfg(target_os = "macos")]
        dispatch2::DispatchQueue::main().exec_sync(tray::create);
    }

    pub fn tray_update(text: String) {
        #[cfg(target_os = "macos")]
        dispatch2::DispatchQueue::main().exec_sync(|| tray::update(&text));
        #[cfg(not(target_os = "macos"))]
        drop(text);
    }

    pub fn tray_update_fast(text: String) {
        #[cfg(target_os = "macos")]
        on_main_fast(|| tray::update(&text));
        #[cfg(not(target_os = "macos"))]
        drop(text);
    }

    pub fn pid_on_main_fast() -> i32 {
        on_main_fast(Self::pid)
    }

    pub fn tray_remove() {
        #[cfg(target_os = "macos")]
        dispatch2::DispatchQueue::main().exec_sync(tray::remove);
    }

    pub fn pid_on_main() -> i32 {
        let mut pid = 0;
        dispatch2::DispatchQueue::main().exec_sync(|| pid = Self::pid());
        pid
    }
}
