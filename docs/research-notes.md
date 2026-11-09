# nsh × NativeScript

Can [Native Shell](https://nsh.dev) (`nsh`) benefit from NativeScript for platform API interop?

On macOS, the iOS simulator and an Android emulator, yes. This repo runs NativeScript inside `nsh`'s own QuickJS VM, so TSX calls AppKit, UIKit and Android's Java APIs directly and native callbacks update `nsh` signals. Linux, Windows and physical phones have not been run.

## How `nsh` reaches platform APIs today

`nsh` has no general platform API access from TSX. An API it does not already wrap needs one of these:

- A **native component**: a factory written per platform (Rust on desktop and iOS, Swift on iOS, Java or Kotlin on Android) and declared in TSX with `nativeComponent()`. Props and events cross as JSON.
- A **native module**: Rust registered with `#[native_module]`, reached from TSX with `nativeModule()`.
- A **change to `nsh` itself**, as with the tray in [PR #988](https://github.com/longbridge/nsh/pull/988).

## Same feature, both ways: macOS tray

| | `nsh` today | `nsh` + NativeScript |
| :--- | :--- | :--- |
| Language | Rust (`objc2`) | TypeScript |
| macOS tray code | [`tray.rs`](https://github.com/longbridge/nsh/blob/36b91689c1e7c38379179a56381de7ddab16c6a5/crates/nsh-platform-macos/src/tray.rs): 242 lines | [`tray.ts`](../apps/tray/tray.ts): 92 lines |
| Excluding blanks and comments | 188 | 81 |
| Needs an `nsh` release | Yes | No |
| Rebuild per change | Rust compile | TSX bundle (about 5 ms here) |

PR #988 as a whole added 3,560 lines across 31 files for tray and global shortcuts on three platforms.

The comparison is not fully like for like:

- `tray.rs` loads icons through `nsh`'s image pipeline. `tray.ts` only takes SF Symbols.
- The PR gives every app a stable cross-platform `Tray` API. `tray.ts` is macOS only, so each platform still needs its own implementation in TS.
- Global shortcuts have not been ported.

Registering a class and handling a click, from each file:

```rust
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ()]
    #[name = "NshTrayTarget"]
    struct TrayTarget;

    unsafe impl NSObjectProtocol for TrayTarget {}

    impl TrayTarget {
        #[unsafe(method(trayClicked:))]
        fn clicked(&self, _sender: Option<&NSObject>) { /* ... */ }
    }
);
```

```ts
class TrayTarget extends NSObject {
  static ObjCExposedMethods = {
    "clicked:": { params: [interop.types.id], returns: interop.types.void },
  };
  static {
    NativeClass(this);
  }
  clicked() { /* ... */ }
}
```

## How it works

`@nativescript/macos-node-api` is a Node-API addon, so it runs on any host that provides Node-API.

- [`crates/nsh-ns/c/quickjs-api.c`](../crates/nsh-ns/c/quickjs-api.c) is NativeScript's QuickJS Node-API binding from the `refactor` branch, adapted to attach to `nsh`'s existing VM.
- [`crates/nsh-ns/c/baton.c`](../crates/nsh-ns/c/baton.c) coordinates the two threads.
- [`patches/nsh-hooks.patch`](../patches/nsh-hooks.patch) adds two hooks to `nsh`: one that runs when a VM is created, and one that runs code on the engine thread.

### Threading

`nsh` runs JS on an engine thread and keeps reactive state in thread-locals, while AppKit and UIKit need the main thread. So JS always runs on the engine thread and native calls run on main by default, with one thread active at a time:

- **JS calling native**: the engine thread waits while main makes the call.
- **Native calling JS during that call**: the JS runs on the waiting engine thread.
- **The run loop calling JS**: main parks the engine between turns, then runs as above.

Each side services the other's work while it waits, so chains that cross repeatedly cannot deadlock.

The threads hand work over through atomic slots and spin for a short, bounded time before sleeping, so a burst of calls pays no thread wake-up after the first one.

The trade-off is that `nsh` promises "the main thread never waits for JS", and a native callback into JS does make main wait. The `react-native` package in NativeScript's `refactor` branch avoids blocking waits by using a second VM on the main thread, at the cost of direct calls from the app's own VM.

### Staying on the engine thread

Some calls can skip the main thread. A call skips it only when all of these hold:

- It is a NativeScript class getter, enum getter, struct property or pointer wrapper, or a member of a listed Foundation class.
- The class is on Apple's [Thread Safety Summary](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafetySummary/ThreadSafetySummary.html) list and does not depend on the calling thread: `NSArray`, `NSAttributedString`, `NSBundle`, `NSCalendar`, `NSCharacterSet`, `NSData`, `NSDate`, `NSDateFormatter`, `NSDecimalNumber`, `NSDictionary`, `NSFileManager`, `NSFormatter`, `NSJSONSerialization`, `NSNumber`, `NSNumberFormatter`, `NSOrderedSet`, `NSSet`, `NSString`, `NSTimeZone`, `NSValue`. Mutable subclasses never qualify.
- The main run loop is idle at that moment.

The idle check is required. NativeScript's internal caches are not locked and its cleanup runs on the run loop, and without the check a stress test crashed in those caches. A call made while main is busy simply crosses as usual, and main counts as idle while it is only polling for the next call.

Everything else still crosses. `NSProcessInfo` is on Apple's unsafe list, and `NSTimer` would attach to a run loop that never runs on the engine thread.

## Verified

| Platform | Test | Result |
| :--- | :--- | :--- |
| macOS arm64 | AppKit and Foundation calls from TSX | Pass |
| macOS arm64 | Real `NSStatusItem` with menu; action reaches an `nsh` signal and the UI updates | Pass, using synthetic clicks |
| macOS arm64 | Concurrent engine timers, run-loop blocks, nested native/JS calls, background-thread blocks, forced GC, 30 s | 0 errors, no deadlock |
| macOS arm64 | Tray with `nsh` production hardening on | Pass |
| iOS 26.5 simulator | `UIDatePicker` added to the window, target-action into a signal | Pass |
| iOS 26.5 simulator | `CADisplayLink` for 120 frames into a signal | Pass |
| iOS 26.5 simulator | `UIAlertController` presented and dismissed, with completion blocks | Pass |
| macOS and iOS simulator | Which thread each call uses, checked with counters | Pass |
| Android 16 emulator | Native `Button` from TSX, click listener into a signal, with a real touch | Pass |
| Android 16 emulator | `Choreographer` for 120 frames into a signal | Pass |
| Android 16 emulator | `AlertDialog` shown and dismissed through listeners | Pass |
| Android 16 emulator | Engine timers, Looper callbacks, nested calls, background-thread callbacks, forced GC, 30 s | 0 errors, no native crash |

iOS uses `@nativescript/ios-node-api@0.4.1-next.2026-08-09-31292056208`. Version 0.4.0 ships without API metadata.

### How Android differs

The published `android-quickjs-ng` package hides its own engine, so Android builds NativeScript's runtime from the `android-react-native` branch without QuickJS. It binds to `nsh`'s VM instead ([`patches/ns-android-external-engine.patch`](../patches/ns-android-external-engine.patch)).

- `crates/nsh-ns-android` builds `libnsh.so`, which exports Node-API and the engine for `libNativeScript.so`.
- The same baton runs on Android's Looper, with NativeScript's `NapiScope` marking each entry into JS.
- NativeScript's GC monitor is a third thread that touches the VM, so entry is exclusive across every thread other than the engine.
- `enableMultithreadedJavascript` must stay off, so Java calls from background threads are routed through main.
- `nsh`'s console and timers are restored after NativeScript starts, because NativeScript installs its own.
- Host objects are disabled, because they need an engine patch that `nsh`'s QuickJS does not have.

## Benchmarks

See the [README](../README.md#performance). Raw results are in [`apps/bench/results`](../apps/bench/results).

## Not done or not verified

- **Physical devices.** iOS has only run on the simulator and Android only on an emulator.
- **Android VM limits.** A stress run stopped after about 14 seconds under `nsh`'s default embedded limits, inside `JS_FreeRuntime`. It passed with the limits lifted, but that run also switched to an optimized build, so the limit is not proven to be the cause. The demo host lifts the limits.
- **VM teardown.** `JS_FreeRuntime` asserts when NativeScript still holds values, so closing the view can abort the process. Clean shutdown is not implemented.
- **Android host app.** It is NativeScript's test app with an `nsh` activity, not a packaged template.
- **Synchronous hops from native code.** A Rust or Swift module that calls `dispatch_sync` to the main queue from a JS callback the main thread is waiting on deadlocks, because the main thread cannot service its queue while it waits.
- **Long blocking calls.** `nsh` interrupts a JS turn after 2 seconds, so anything that blocks inside one, such as a synchronous modal alert, is likely to be cut off. Use the asynchronous sheet and completion APIs.
- **Memory.** A loop of `NSString.stringWithString` with a JS string grows about 6 MB/s here. NativeScript alone on Node also grows on the same loop, so this looks like a NativeScript issue.
- **Idle check coverage.** The check observes the run loop's common modes only, so main-thread work in a private run loop mode is not detected.
- **Physical clicks.** The tray was driven through AppKit's `performClick` and `performActionForItemAtIndex`.
- **Sandbox.** NativeScript bypasses `nsh`'s capability system, so it must never be enabled for untrusted signed modules.
- **One VM per process.** The bridge holds one global env and targets the most recently started engine.
- **Object release thread.** GC finalizers run on the engine thread, so AppKit objects can be released off main. The stress test did not crash, but this should move to main.
- **Types.** The published `@nativescript/macos-node-api` tarball omits its `types` directory, so the demos use `declare const`.

## Other platforms

Neither of these has been built or run. On iOS, `@nativescript/ios-quickjs` bundles its own engine and cannot share `nsh`'s VM, so this repo uses `ios-node-api`.

| Platform | Finding | Expected path |
| :--- | :--- | :--- |
| Linux | `linux-napi` is a Node-API addon over GTK and GLib, and its typings include GDBus. The package ships x64 only. | Port the bridge; replace Apple threading with GLib |
| Windows | `windows-napi` is a Node-API addon for WinRT only. The PR's tray and shortcuts use Win32 APIs that it does not cover. | Port the bridge; Win32 needs separate work |

## Run it

```sh
cd vendor/nsh
cargo +stable build -p nsh-ns -p nsh-cli --release

cd ../../apps/tray
../../vendor/nsh/target/release/nsh build
RUST_LOG=js=info,warn ../../vendor/nsh/target/release/nsh-ns .nsh/out/bundle.js
```

`apps/smoke` and `apps/stress` run the same way. Set `NSH_NS_HARDEN=1` to enable `nsh`'s production hardening.

For the iOS simulator, build the host and launch an app:

```sh
cd vendor/nsh
cargo +stable build -p nsh-ns --release --target aarch64-apple-ios-sim

cd ../..
scripts/ios-sim.sh apps/uikit <simulator-udid> /tmp/uikit.log
```

To rerun the benchmarks, use `scripts/bench-macos.sh <output.json>`, `scripts/bench-ios.sh <simulator-udid> <output.json>` and `node apps/bench/node-bench.mjs`.

For Android, with an arm64 emulator running and the patch applied to the `android-react-native` branch in `vendor/ns-android`:

```sh
scripts/build-android.sh
cp vendor/nsh/target/aarch64-linux-android/release/libnsh_android_host.so apps/android-host/jniLibs/arm64-v8a/libnsh.so
scripts/android-apk.sh apps/android
scripts/android-run.sh 8
```

`apps/android-check` runs the stress test and benchmarks. Create `/data/local/tmp/nsh-stress` on the device to include the stress test.
