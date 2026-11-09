//! The `ns.view` element: an empty view nsh lays out, handed to TypeScript to
//! fill. Creation only reports the view's address, so the main thread never
//! has to enter JS while nsh is applying a commit.

use std::rc::Rc;

use objc2::{MainThreadMarker, rc::Retained};
use serde_json::{Value, json};

#[cfg(target_os = "ios")]
use nsh_platform_ios::{ComponentContext, Components, NativeComponent};
#[cfg(target_os = "macos")]
use nsh_platform_macos::{ComponentContext, Components, NativeComponent};
#[cfg(target_os = "macos")]
use objc2_app_kit::NSView as PlatformView;
#[cfg(target_os = "ios")]
use objc2_ui_kit::UIView as PlatformView;

struct Host(Retained<PlatformView>);

impl NativeComponent for Host {
    #[cfg(target_os = "macos")]
    fn view(&self) -> Retained<PlatformView> {
        self.0.clone()
    }

    #[cfg(target_os = "ios")]
    fn view(&self) -> &PlatformView {
        &self.0
    }

    fn set_prop(&mut self, _name: &str, _value: Option<&Value>) {}
}

pub fn register(components: &Components) {
    components.register(
        "ns.view",
        Rc::new(|context: ComponentContext| -> Box<dyn NativeComponent> {
            let main = MainThreadMarker::new().expect("components are made on the main thread");
            let view = PlatformView::new(main);
            context.emit("ready", json!({ "handle": Retained::as_ptr(&view) as usize as u64 }));
            Box::new(Host(view))
        }),
    );
}
