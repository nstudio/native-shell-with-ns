#ifndef NSH_BRIDGE_H
#define NSH_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

#include "js_native_api.h"
#include "quickjs.h"

typedef void (*NshTask)(void* arg);

/* Where native calls made from JS run. AUTO keeps calls that are known to be
   safe off the main thread on the engine thread and sends the rest to main. */
enum { NSH_CALLS_AUTO, NSH_CALLS_MAIN, NSH_CALLS_ENGINE };
extern int nsh_call_mode;
extern uint64_t nsh_engine_calls;
extern uint64_t nsh_main_calls;

typedef enum {
  NSH_CALLBACK_OTHER,
  NSH_CALLBACK_PURE,
  NSH_CALLBACK_OBJC_MEMBER,
} NshCallbackKind;

/* NativeScript's caches are not locked and its cleanup runs on the run loop,
   so a call may stay on the engine thread only while the run loop is idle.
   False means the call must go to the main thread. */
bool nsh_enter_engine_call(void);
void nsh_leave_engine_call(void);

NshCallbackKind nsh_classify_callback(void* callback);
bool nsh_object_allows_engine_calls(void* object);

bool nsh_is_engine_thread(void);

/* True on a non-engine thread that holds the VM while the engine waits. */
bool nsh_thread_holds_vm(void);

/* True on a thread that may touch the VM right now: always on the engine
   thread, and on the main thread while the engine is waiting on it. */
extern __thread bool nsh_vm_held;

/* Takes the VM when the run loop calls into Node-API on its own, parking the
   engine thread between its turns until the run loop moves on. */
void nsh_ensure_vm_slow(void);

static inline void nsh_ensure_vm(void) {
  if (__builtin_expect(nsh_vm_held, 1)) return;
  nsh_ensure_vm_slow();
}

void nsh_run_on_main(NshTask task, void* arg);
void nsh_run_on_engine(NshTask task, void* arg);
void nsh_post_to_main(NshTask task, void* arg);

napi_status nsh_attach_env(JSContext* context, napi_env* result);

/* Implemented in Rust: queues `task` on the engine thread. */
bool nsh_post_to_engine(NshTask task, void* arg);

void nsh_ns_attach(JSContext* context, const char* framework_path);
void nsh_ns_engine_park(void* unused);

#endif
