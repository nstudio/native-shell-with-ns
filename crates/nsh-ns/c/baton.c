// The QuickJS VM is used by one thread at a time. JS runs on the engine thread
// because nsh's reactive core keeps its state in thread-locals, and platform
// calls run on the main thread because AppKit requires it. Each side services
// the other's pending work while it waits, so a call chain that crosses
// threads repeatedly (JS -> native -> delegate -> JS -> native) cannot
// deadlock.

#ifdef __ANDROID__
#include <android/looper.h>
#include <fcntl.h>
#include <jni.h>
#include <sys/syscall.h>
#include <unistd.h>
#else
#include <CoreFoundation/CoreFoundation.h>
#include <dispatch/dispatch.h>
#include <dlfcn.h>
#include <objc/runtime.h>
#endif
#include <limits.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "nsh_bridge.h"

typedef struct {
  NshTask task;
  void* arg;
  atomic_bool done;
} Job;

// Guards only the sleeping side of each hand-off; a thread that finds work
// while it spins never touches it.
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t main_wait = PTHREAD_COND_INITIALIZER;
static pthread_cond_t engine_wait = PTHREAD_COND_INITIALIZER;

static pthread_t engine_thread;
static JSRuntime* runtime;
static napi_env bridge_env;
static _Atomic(Job*) job_for_main;
static _Atomic(Job*) job_for_engine;
static atomic_bool engine_parked;
static atomic_bool release_engine;
// True while main polls job_for_main, so a job needs no run loop wake-up.
static atomic_bool main_watching;
static atomic_int main_sleepers;
static atomic_bool engine_sleeping;

__thread bool nsh_vm_held;
#define main_holds_vm nsh_vm_held

// Touched only on the main thread.
static bool main_entered_from_run_loop;
static int main_calls_into_js;
static bool observer_installed;
// Starts busy: main runs before the first run loop turn. Android has no idle
// observers, and AUTO never skips the crossing there, so only an explicit
// NSH_CALLS_ENGINE reaches this check.
#ifdef __ANDROID__
static atomic_bool main_busy = false;
#else
static atomic_bool main_busy = true;
#endif
static atomic_int engine_calls_in_progress;
static napi_handle_scope run_loop_scope;

#ifdef __ANDROID__
bool nsh_android_thread_entered(void);
#endif

#ifdef __ANDROID__
static pthread_t android_main_thread;
#endif

static bool on_main_thread(void) {
#ifdef __ANDROID__
  return pthread_equal(pthread_self(), android_main_thread);
#else
  return pthread_main_np();
#endif
}

bool nsh_is_engine_thread(void) {
  return pthread_equal(pthread_self(), engine_thread);
}

bool nsh_thread_holds_vm(void) {
  if (nsh_is_engine_thread()) return false;
#ifdef __ANDROID__
  if (nsh_android_thread_entered()) return true;
#endif
  return on_main_thread() && main_holds_vm;
}

// Long enough to bridge the gap between consecutive native calls from JS, short
// enough that giving up costs nothing a person could notice. Counted rather
// than timed: reading the clock can cost as much as the wait it is timing.
#ifdef __ANDROID__
enum { kSpinIterations = 3000 };
#else
enum { kSpinIterations = 1500 };
#endif

static inline void cpu_relax(void) {
#if defined(__aarch64__)
  __asm__ __volatile__("isb");
#elif defined(__x86_64__)
  __asm__ __volatile__("pause");
#endif
}

static void notify_engine(void) {
  if (!atomic_load(&engine_sleeping)) return;
  pthread_mutex_lock(&lock);
  pthread_cond_broadcast(&engine_wait);
  pthread_mutex_unlock(&lock);
}

static void notify_main_side(void) {
  if (atomic_load(&main_sleepers) == 0) return;
  pthread_mutex_lock(&lock);
  pthread_cond_broadcast(&main_wait);
  pthread_mutex_unlock(&lock);
}

static bool service_main(void) {
  Job* job = atomic_exchange(&job_for_main, NULL);
  if (job == NULL) return false;
  bool held = main_holds_vm;
  main_holds_vm = true;
  JS_UpdateStackTop(runtime);
  job->task(job->arg);
  main_holds_vm = held;
  // The waiter owns job and may return as soon as this is set.
  atomic_store(&job->done, true);
  notify_engine();
  return true;
}

static bool service_engine(void) {
  Job* job = atomic_exchange(&job_for_engine, NULL);
  if (job == NULL) return false;
  JS_UpdateStackTop(runtime);
  job->task(job->arg);
  atomic_store(&job->done, true);
  notify_main_side();
  return true;
}

typedef bool (*Ready)(void* arg);

static bool job_is_done(void* arg) { return atomic_load(&((Job*)arg)->done); }
static bool flag_is_set(void* arg) { return atomic_load((atomic_bool*)arg); }
static bool flag_is_clear(void* arg) { return !atomic_load((atomic_bool*)arg); }
static bool no_engine_calls(void* arg) {
  return atomic_load(&engine_calls_in_progress) == 0;
}

static void engine_wait_until(Ready ready, void* arg) {
  for (unsigned spins = 0; spins < kSpinIterations; spins++) {
    if (ready(arg)) return;
    if (service_engine()) spins = 0;
    cpu_relax();
  }
  pthread_mutex_lock(&lock);
  atomic_store(&engine_sleeping, true);
  while (!ready(arg)) {
    if (atomic_load(&job_for_engine) != NULL) {
      atomic_store(&engine_sleeping, false);
      pthread_mutex_unlock(&lock);
      service_engine();
      pthread_mutex_lock(&lock);
      atomic_store(&engine_sleeping, true);
    } else {
      pthread_cond_wait(&engine_wait, &lock);
    }
  }
  atomic_store(&engine_sleeping, false);
  pthread_mutex_unlock(&lock);
}

// A job posted while main_watching was set got no wake-up, so the watcher must
// look once more after clearing it.
static void stop_watching(void) {
  atomic_store(&main_watching, false);
  service_main();
}

// Waits on the main thread or on a thread that took the VM from it. Only the
// main thread can run jobs meanwhile.
static void main_side_wait_until(Ready ready, void* arg) {
  bool on_main = on_main_thread();
  if (on_main) atomic_store(&main_watching, true);
  for (unsigned spins = 0; spins < kSpinIterations; spins++) {
    if (ready(arg)) {
      if (on_main) stop_watching();
      return;
    }
    if (on_main && service_main()) {
      // A job can wait on the engine in turn, which ends that wait's watching.
      atomic_store(&main_watching, true);
      spins = 0;
    }
    cpu_relax();
  }
  if (on_main) atomic_store(&main_watching, false);
  pthread_mutex_lock(&lock);
  atomic_fetch_add(&main_sleepers, 1);
  while (!ready(arg)) {
    if (on_main && atomic_load(&job_for_main) != NULL) {
      pthread_mutex_unlock(&lock);
      service_main();
      pthread_mutex_lock(&lock);
    } else {
      pthread_cond_wait(&main_wait, &lock);
    }
  }
  atomic_fetch_sub(&main_sleepers, 1);
  pthread_mutex_unlock(&lock);
}

static void drain_main(void* unused);

#ifdef __ANDROID__
static int wake_pipe[2] = {-1, -1};

static void wake_main_thread(void) {
  char byte = 1;
  // A full pipe means a wake-up is already pending.
  (void)write(wake_pipe[1], &byte, 1);
}
#else
static void wake_main_thread(void) {
  dispatch_async_f(dispatch_get_main_queue(), NULL, drain_main);
}
#endif

// Stays on the job slot briefly after the last job, because JS usually makes
// its next native call within microseconds and a run loop wake-up costs far
// more than the wait.
static void main_stops_polling(void);

static void drain_main(void* unused) {
  if (!service_main()) return;
  for (;;) {
    atomic_store(&main_watching, true);
#ifndef __ANDROID__
    // Polling touches no NativeScript state. A job only arrives while the
    // engine waits for it, so it cannot overlap a direct call.
    atomic_store(&main_busy, false);
#endif
    for (unsigned spins = 0; spins < kSpinIterations; spins++) {
      if (service_main()) {
        atomic_store(&main_watching, true);
        spins = 0;
      }
      cpu_relax();
    }
    main_stops_polling();
    atomic_store(&main_watching, false);
    if (atomic_load(&job_for_main) == NULL) return;
  }
}

void nsh_run_on_main(NshTask task, void* arg) {
  Job job = {task, arg, false};
  atomic_store(&job_for_main, &job);
  if (!atomic_load(&main_watching)) wake_main_thread();
  notify_main_side();
  engine_wait_until(job_is_done, &job);
  JS_UpdateStackTop(runtime);
}

void nsh_run_on_engine(NshTask task, void* arg) {
  Job job = {task, arg, false};
  bool on_main = on_main_thread();
  if (on_main) main_calls_into_js++;
  atomic_store(&job_for_engine, &job);
  notify_engine();
  main_side_wait_until(job_is_done, &job);
  if (on_main) main_calls_into_js--;
  JS_UpdateStackTop(runtime);
}

void nsh_ns_engine_park(void* unused) {
  atomic_store(&engine_parked, true);
  notify_main_side();
  engine_wait_until(flag_is_set, &release_engine);
  atomic_store(&release_engine, false);
  atomic_store(&engine_parked, false);
  notify_main_side();
  JS_UpdateStackTop(runtime);
}

static void main_stops_polling(void) {
#ifndef __ANDROID__
  atomic_store(&main_busy, true);
  main_side_wait_until(no_engine_calls, NULL);
#endif
}

static void release_parked_engine(void) {
  atomic_store(&release_engine, true);
  notify_engine();
  // A later entry must not mistake this park for a new one.
  main_side_wait_until(flag_is_clear, &engine_parked);
}

bool nsh_enter_engine_call(void) {
  atomic_fetch_add(&engine_calls_in_progress, 1);
  if (!atomic_load(&main_busy)) return true;
  nsh_leave_engine_call();
  return false;
}

void nsh_leave_engine_call(void) {
  if (atomic_fetch_sub(&engine_calls_in_progress, 1) == 1) notify_main_side();
}

#ifndef __ANDROID__
static void main_becomes_busy(CFRunLoopObserverRef observer,
                              CFRunLoopActivity activity, void* info) {
  atomic_store(&main_busy, true);
  // A JS callback inside the engine's call can cross to main.
  main_side_wait_until(no_engine_calls, NULL);
}

static void main_becomes_idle(CFRunLoopObserverRef observer,
                              CFRunLoopActivity activity, void* info) {
  atomic_store(&main_busy, false);
}

static void install_idle_observers(void) {
  CFRunLoopRef run_loop = CFRunLoopGetMain();
  CFRunLoopAddObserver(
      run_loop,
      CFRunLoopObserverCreate(NULL,
                              kCFRunLoopEntry | kCFRunLoopAfterWaiting | kCFRunLoopExit,
                              true, LONG_MIN, main_becomes_busy, NULL),
      kCFRunLoopCommonModes);
  CFRunLoopAddObserver(
      run_loop,
      CFRunLoopObserverCreate(NULL, kCFRunLoopBeforeWaiting, true, LONG_MAX,
                              main_becomes_idle, NULL),
      kCFRunLoopCommonModes);
}

static void release_after_run_loop_turn(CFRunLoopObserverRef observer,
                                        CFRunLoopActivity activity, void* info) {
  if (!main_entered_from_run_loop || main_calls_into_js > 0) return;
  main_entered_from_run_loop = false;
  napi_close_handle_scope(bridge_env, run_loop_scope);
  main_holds_vm = false;
  release_parked_engine();
}

void nsh_ensure_vm_slow(void) {
  if (!pthread_main_np() || main_holds_vm) return;
  if (!observer_installed) {
    observer_installed = true;
    CFRunLoopObserverRef observer = CFRunLoopObserverCreate(
        NULL, kCFRunLoopAllActivities, true, 0, release_after_run_loop_turn,
        NULL);
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  }
  if (!nsh_post_to_engine(nsh_ns_engine_park, NULL)) return;
  main_side_wait_until(flag_is_set, &engine_parked);
  main_holds_vm = true;
  main_entered_from_run_loop = true;
  JS_UpdateStackTop(runtime);
  // Node-API values need an open scope; nothing on the run loop opened one.
  napi_open_handle_scope(bridge_env, &run_loop_scope);
}

#endif  // !__ANDROID__

static uint64_t boot_nanos;

static uint64_t now_nanos(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000000000u + (uint64_t)t.tv_nsec;
}

static JSValue set_call_mode(JSContext* context, JSValueConst self, int argc,
                             JSValueConst* argv) {
  int mode = NSH_CALLS_AUTO;
  if (argc > 0) JS_ToInt32(context, &mode, argv[0]);
  nsh_call_mode = mode;
  return JS_UNDEFINED;
}

static JSValue call_stats(JSContext* context, JSValueConst self, int argc,
                          JSValueConst* argv) {
  JSValue stats = JS_NewObject(context);
  JS_SetPropertyStr(context, stats, "engine",
                    JS_NewFloat64(context, (double)nsh_engine_calls));
  JS_SetPropertyStr(context, stats, "main",
                    JS_NewFloat64(context, (double)nsh_main_calls));
  JS_SetPropertyStr(context, stats, "bootNanos",
                    JS_NewFloat64(context, (double)boot_nanos));
  return stats;
}

static void install_call_mode_globals(JSContext* context) {
  JSValue global = JS_GetGlobalObject(context);
  JS_SetPropertyStr(context, global, "__nshNsCallMode",
                    JS_NewCFunction(context, set_call_mode, "__nshNsCallMode", 1));
  JS_SetPropertyStr(context, global, "__nshNsCallStats",
                    JS_NewCFunction(context, call_stats, "__nshNsCallStats", 0));
  JS_FreeValue(context, global);
}

#ifdef __ANDROID__
typedef struct PostedNode {
  NshTask task;
  void* arg;
  struct PostedNode* next;
} PostedNode;

static PostedNode* posted_head;
static PostedNode* posted_tail;

void nsh_post_to_main(NshTask task, void* arg) {
  PostedNode* node = malloc(sizeof(*node));
  node->task = task;
  node->arg = arg;
  node->next = NULL;
  pthread_mutex_lock(&lock);
  if (posted_tail != NULL) {
    posted_tail->next = node;
  } else {
    posted_head = node;
  }
  posted_tail = node;
  pthread_mutex_unlock(&lock);
  wake_main_thread();
}

static void run_posted_tasks(void) {
  for (;;) {
    pthread_mutex_lock(&lock);
    PostedNode* node = posted_head;
    if (node != NULL) {
      posted_head = node->next;
      if (posted_head == NULL) posted_tail = NULL;
    }
    pthread_mutex_unlock(&lock);
    if (node == NULL) return;
    node->task(node->arg);
    free(node);
  }
}

static int on_main_wake(int fd, int events, void* data) {
  char buffer[64];
  while (read(fd, buffer, sizeof(buffer)) > 0) {
  }
  drain_main(NULL);
  run_posted_tasks();
  return 1;
}

// Java reaches JS through NativeScript's scope objects, which bracket every
// entry precisely. Besides the main thread these also run on NativeScript's GC
// monitor thread, so entry is exclusive across all non-engine threads.
static atomic_bool foreign_owner;
static __thread int entry_depth;

bool nsh_android_thread_entered(void) { return entry_depth > 0; }

void nsh_android_enter_vm(void) {
  if (nsh_is_engine_thread()) return;
  if (entry_depth > 0 || (on_main_thread() && main_holds_vm)) {
    entry_depth++;
    return;
  }
  for (;;) {
    bool expected = false;
    if (atomic_compare_exchange_strong(&foreign_owner, &expected, true)) break;
    main_side_wait_until(flag_is_clear, &foreign_owner);
  }
  if (!nsh_post_to_engine(nsh_ns_engine_park, NULL)) {
    atomic_store(&foreign_owner, false);
    notify_main_side();
    return;
  }
  main_side_wait_until(flag_is_set, &engine_parked);
  if (on_main_thread()) {
    main_holds_vm = true;
    main_entered_from_run_loop = true;
  }
  entry_depth = 1;
  JS_UpdateStackTop(runtime);
}

void nsh_android_leave_vm(void) {
  if (nsh_is_engine_thread() || entry_depth == 0) return;
  if (--entry_depth > 0) return;
  if (on_main_thread()) {
    if (!main_entered_from_run_loop) return;
    main_entered_from_run_loop = false;
    main_holds_vm = false;
  }
  release_parked_engine();
  atomic_store(&foreign_owner, false);
  notify_main_side();
}

static void leave_vm_task(void* unused) { nsh_android_leave_vm(); }

void nsh_ensure_vm_slow(void) {
  if (!on_main_thread() || main_holds_vm || entry_depth > 0) return;
  // A call NativeScript did not bracket holds the VM until the next Looper turn.
  nsh_android_enter_vm();
  nsh_post_to_main(leave_vm_task, NULL);
}

NshCallbackKind nsh_classify_callback(void* callback) { return NSH_CALLBACK_OTHER; }

bool nsh_object_allows_engine_calls(void* object) { return false; }

static JavaVM* java_vm;
static jclass bridge_class;
static jclass process_class;
static jmethodID my_pid_method;
static jmethodID pid_on_main_method;
static __thread JNIEnv* attached_env;

static JNIEnv* env_for_this_thread(void) {
  if (attached_env == NULL) {
    (*java_vm)->AttachCurrentThread(java_vm, &attached_env, NULL);
  }
  return attached_env;
}

int nsh_android_bench_pid(void) {
  JNIEnv* env = env_for_this_thread();
  return (*env)->CallStaticIntMethod(env, process_class, my_pid_method);
}

int nsh_android_bench_pid_on_main(void) {
  JNIEnv* env = env_for_this_thread();
  return (*env)->CallStaticIntMethod(env, bridge_class, pid_on_main_method);
}

void nsh_android_bind_main(JNIEnv* env, jclass bridge) {
  android_main_thread = pthread_self();
  (*env)->GetJavaVM(env, &java_vm);
  bridge_class = (*env)->NewGlobalRef(env, bridge);
  jclass process = (*env)->FindClass(env, "android/os/Process");
  process_class = (*env)->NewGlobalRef(env, process);
  my_pid_method = (*env)->GetStaticMethodID(env, process_class, "myPid", "()I");
  pid_on_main_method = (*env)->GetStaticMethodID(env, bridge_class, "pidOnMain", "()I");
  pipe(wake_pipe);
  fcntl(wake_pipe[0], F_SETFL, O_NONBLOCK);
  fcntl(wake_pipe[1], F_SETFL, O_NONBLOCK);
  ALooper_addFd(ALooper_forThread(), wake_pipe[0], ALOOPER_POLL_CALLBACK,
                ALOOPER_EVENT_INPUT, on_main_wake, NULL);
}

static void boot_nativescript(void* unused) {
  JNIEnv* env = NULL;
  (*java_vm)->GetEnv(java_vm, (void**)&env, JNI_VERSION_1_6);
  jmethodID boot =
      (*env)->GetStaticMethodID(env, bridge_class, "bootNativeScript", "()V");
  (*env)->CallStaticVoidMethod(env, bridge_class, boot);
  if ((*env)->ExceptionCheck(env)) {
    (*env)->ExceptionDescribe(env);
    (*env)->ExceptionClear(env);
  }
}

void nsh_ns_attach(JSContext* context, const char* framework_path) {
  uint64_t boot_started = now_nanos();
  engine_thread = pthread_self();
  nsh_vm_held = true;
  runtime = JS_GetRuntime(context);
  napi_env env = NULL;
  if (nsh_attach_env(context, &env) != napi_ok) {
    fprintf(stderr, "nsh-ns: cannot create a Node-API env\n");
    return;
  }
  bridge_env = env;
  // NativeScript's startup installs its own console and timers. The app keeps
  // nsh's, which run on the engine and stay in step with its commits.
  static const char* const kNshGlobals[] = {"console", "setTimeout", "setInterval",
                                            "clearTimeout", "clearInterval"};
  enum { kNshGlobalCount = sizeof(kNshGlobals) / sizeof(*kNshGlobals) };
  JSValue global = JS_GetGlobalObject(context);
  JSValue saved[kNshGlobalCount];
  for (int i = 0; i < kNshGlobalCount; i++) {
    saved[i] = JS_GetPropertyStr(context, global, kNshGlobals[i]);
  }
  nsh_run_on_main(boot_nativescript, NULL);
  for (int i = 0; i < kNshGlobalCount; i++) {
    JS_SetPropertyStr(context, global, kNshGlobals[i], saved[i]);
  }
  JS_FreeValue(context, global);
  boot_nanos = now_nanos() - boot_started;
  install_call_mode_globals(context);
}
#else
typedef struct {
  NshTask task;
  void* arg;
} PostedTask;

static void run_posted_task(void* context) {
  PostedTask* posted = context;
  posted->task(posted->arg);
  free(posted);
}

void nsh_post_to_main(NshTask task, void* arg) {
  PostedTask* posted = malloc(sizeof(*posted));
  posted->task = task;
  posted->arg = arg;
  dispatch_async_f(dispatch_get_main_queue(), posted, run_posted_task);
}

#endif  // __ANDROID__

#ifndef __ANDROID__
typedef struct {
  napi_env env;
  void (*init)(void* env, const char* metadata_path, const void* metadata_ptr);
} InitCall;

static void init_nativescript(void* arg) {
  InitCall* call = arg;
  napi_handle_scope scope;
  napi_open_handle_scope(call->env, &scope);
  install_idle_observers();
  call->init(call->env, NULL, NULL);
  napi_close_handle_scope(call->env, scope);
}

// Apple's "Thread Safety Summary", without the classes whose behavior depends
// on the calling thread (NSTimer, NSThread, NSNotificationCenter, NSObject).
static const char* const kEngineSafeClasses[] = {
    "NSArray",          "NSAttributedString", "NSBundle",         "NSCalendar",
    "NSCharacterSet",   "NSData",             "NSDate",           "NSDateFormatter",
    "NSDecimalNumber",  "NSDictionary",       "NSFileManager",    "NSFormatter",
    "NSJSONSerialization", "NSNumber",        "NSNumberFormatter", "NSOrderedSet",
    "NSSet",            "NSString",           "NSTimeZone",       "NSValue",
};

// Listed in that summary as unsafe. Checked first because these subclass
// classes in the list above.
static const char* const kEngineUnsafeClasses[] = {
    "NSMutableArray",        "NSMutableAttributedString", "NSMutableCharacterSet",
    "NSMutableData",         "NSMutableDictionary",       "NSMutableOrderedSet",
    "NSMutableSet",          "NSMutableString",           "NSCountedSet",
};

static bool name_is_listed(const char* name, const char* const* list, size_t count) {
  for (size_t i = 0; i < count; i++) {
    if (strcmp(name, list[i]) == 0) return true;
  }
  return false;
}

static bool class_allows_engine_calls(Class cls) {
  for (Class current = cls; current != Nil; current = class_getSuperclass(current)) {
    const char* name = class_getName(current);
    if (name_is_listed(name, kEngineUnsafeClasses,
                       sizeof(kEngineUnsafeClasses) / sizeof(*kEngineUnsafeClasses))) {
      return false;
    }
    if (name_is_listed(name, kEngineSafeClasses,
                       sizeof(kEngineSafeClasses) / sizeof(*kEngineSafeClasses))) {
      return true;
    }
  }
  return false;
}

// Read and written only on the engine thread.
enum { kClassCacheSize = 4096 };
static struct {
  Class cls;
  bool allowed;
} class_cache[kClassCacheSize];

bool nsh_object_allows_engine_calls(void* object) {
  Class cls = object_getClass((id)object);
  if (cls == Nil) return false;
  size_t slot = ((uintptr_t)cls >> 4) & (kClassCacheSize - 1);
  if (class_cache[slot].cls == cls) return class_cache[slot].allowed;
  bool allowed = class_allows_engine_calls(cls);
  class_cache[slot].cls = cls;
  class_cache[slot].allowed = allowed;
  return allowed;
}

static void* objc_member_callbacks[4];
static void* pure_callbacks[5];

NshCallbackKind nsh_classify_callback(void* callback) {
  for (size_t i = 0; i < sizeof(objc_member_callbacks) / sizeof(void*); i++) {
    if (callback != NULL && callback == objc_member_callbacks[i]) {
      return NSH_CALLBACK_OBJC_MEMBER;
    }
  }
  for (size_t i = 0; i < sizeof(pure_callbacks) / sizeof(void*); i++) {
    if (callback != NULL && callback == pure_callbacks[i]) return NSH_CALLBACK_PURE;
  }
  return NSH_CALLBACK_OTHER;
}

static void find_callbacks(void* framework) {
  // A symbol a runtime version does not export stays NULL, so its calls go to
  // the main thread.
  objc_member_callbacks[0] = dlsym(
      framework, "_ZN12nativescript15ObjCClassMember6jsCallEP10napi_env__P20napi_callback_info__");
  objc_member_callbacks[1] = dlsym(
      framework, "_ZN12nativescript15ObjCClassMember8jsGetterEP10napi_env__P20napi_callback_info__");
  objc_member_callbacks[2] = dlsym(
      framework, "_ZN12nativescript15ObjCClassMember8jsSetterEP10napi_env__P20napi_callback_info__");
  objc_member_callbacks[3] = dlsym(
      framework, "_ZN12nativescript15ObjCClassMember10jsCallInitEP10napi_env__P20napi_callback_info__");
  pure_callbacks[0] = dlsym(
      framework, "_ZN12nativescript13JS_enumGetterEP10napi_env__P20napi_callback_info__");
  pure_callbacks[1] = dlsym(
      framework, "_ZN12nativescript23JS_StructPropertyGetterEP10napi_env__P20napi_callback_info__");
  pure_callbacks[2] = dlsym(
      framework, "_ZN12nativescript23JS_StructPropertySetterEP10napi_env__P20napi_callback_info__");
  // Resolves a class with objc_getClass, which does not trigger +initialize.
  pure_callbacks[3] = dlsym(
      framework, "_ZN12nativescript14JS_classGetterEP10napi_env__P20napi_callback_info__");
  // Wraps a native pointer in a JS object for each object a call returns.
  pure_callbacks[4] = dlsym(
      framework, "_ZN12nativescript7Pointer11constructorEP10napi_env__P20napi_callback_info__");
}

void nsh_ns_attach(JSContext* context, const char* framework_path) {
  uint64_t boot_started = now_nanos();
  engine_thread = pthread_self();
  nsh_vm_held = true;
  runtime = JS_GetRuntime(context);
  napi_env env = NULL;
  if (nsh_attach_env(context, &env) != napi_ok) {
    fprintf(stderr, "nsh-ns: cannot create a Node-API env\n");
    return;
  }
  bridge_env = env;
  void* framework = dlopen(framework_path, RTLD_NOW | RTLD_GLOBAL);
  if (framework == NULL) {
    fprintf(stderr, "nsh-ns: %s\n", dlerror());
    return;
  }
  find_callbacks(framework);
  InitCall call = {env, dlsym(framework, "nativescript_init")};
  nsh_run_on_main(init_nativescript, &call);

  boot_nanos = now_nanos() - boot_started;
  install_call_mode_globals(context);
}
#endif  // !__ANDROID__
