use std::sync::{Arc, Mutex};

pub struct SleepInhibitor {
    inner: Arc<SleepInhibitorInner>,
}

struct SleepInhibitorInner {
    state: Mutex<SleepInhibitorState>,
}

struct SleepInhibitorState {
    enabled: bool,
    active_downloads: usize,
    request_active: bool,
    backend: Box<dyn PowerBackend>,
}

trait PowerBackend: Send {
    fn acquire(&mut self) -> Result<(), String>;
    fn release(&mut self);
}

pub struct DownloadSleepGuard {
    inner: Arc<SleepInhibitorInner>,
}

impl SleepInhibitor {
    pub fn new(enabled: bool) -> Self {
        Self::with_backend(enabled, Box::new(platform::SystemPowerBackend::default()))
    }

    fn with_backend(enabled: bool, backend: Box<dyn PowerBackend>) -> Self {
        Self {
            inner: Arc::new(SleepInhibitorInner {
                state: Mutex::new(SleepInhibitorState {
                    enabled,
                    active_downloads: 0,
                    request_active: false,
                    backend,
                }),
            }),
        }
    }

    pub fn begin_download(&self) -> DownloadSleepGuard {
        let mut state = self.inner.state.lock().expect("power state mutex poisoned");
        state.active_downloads = state.active_downloads.saturating_add(1);
        reconcile(&mut state);
        drop(state);
        DownloadSleepGuard {
            inner: self.inner.clone(),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        let mut state = self.inner.state.lock().expect("power state mutex poisoned");
        state.enabled = enabled;
        reconcile(&mut state);
    }

    pub fn refresh_after_wake(&self) {
        let mut state = self.inner.state.lock().expect("power state mutex poisoned");
        release_request(&mut state);
        reconcile(&mut state);
    }

    pub fn shutdown(&self) {
        let mut state = self.inner.state.lock().expect("power state mutex poisoned");
        state.enabled = false;
        release_request(&mut state);
    }
}

impl Clone for SleepInhibitor {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl Drop for DownloadSleepGuard {
    fn drop(&mut self) {
        let mut state = self.inner.state.lock().expect("power state mutex poisoned");
        state.active_downloads = state.active_downloads.saturating_sub(1);
        reconcile(&mut state);
    }
}

fn reconcile(state: &mut SleepInhibitorState) {
    let should_be_active = state.enabled && state.active_downloads > 0;
    if should_be_active && !state.request_active {
        match state.backend.acquire() {
            Ok(()) => state.request_active = true,
            Err(error) => eprintln!("could not prevent system sleep: {error}"),
        }
    } else if !should_be_active {
        release_request(state);
    }
}

fn release_request(state: &mut SleepInhibitorState) {
    if state.request_active {
        state.backend.release();
        state.request_active = false;
    }
}

pub fn install_wake_listener(inhibitor: SleepInhibitor) -> Result<WakeListener, String> {
    platform::install_wake_listener(inhibitor)
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{PowerBackend, SleepInhibitor};
    use std::ffi::c_void;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, WIN32_ERROR};
    use windows::Win32::System::Power::{
        PowerClearRequest, PowerCreateRequest, PowerRegisterSuspendResumeNotification,
        PowerRequestSystemRequired, PowerSetRequest, PowerUnregisterSuspendResumeNotification,
        DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HPOWERNOTIFY,
    };
    use windows::Win32::System::Threading::{
        POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMECRITICAL,
        PBT_APMRESUMESTANDBY, PBT_APMRESUMESUSPEND,
    };

    #[derive(Default)]
    pub struct SystemPowerBackend {
        request_handle: Option<usize>,
    }

    impl PowerBackend for SystemPowerBackend {
        fn acquire(&mut self) -> Result<(), String> {
            if self.request_handle.is_some() {
                return Ok(());
            }
            let mut reason = "YTLoadster is downloading media"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>();
            let context = REASON_CONTEXT {
                Version: 0,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: PWSTR(reason.as_mut_ptr()),
                },
            };
            let handle =
                unsafe { PowerCreateRequest(&context) }.map_err(|error| error.to_string())?;
            if let Err(error) = unsafe { PowerSetRequest(handle, PowerRequestSystemRequired) } {
                let _ = unsafe { CloseHandle(handle) };
                return Err(error.to_string());
            }
            self.request_handle = Some(handle.0 as usize);
            Ok(())
        }

        fn release(&mut self) {
            let Some(raw_handle) = self.request_handle.take() else {
                return;
            };
            let handle = HANDLE(raw_handle as *mut c_void);
            let _ = unsafe { PowerClearRequest(handle, PowerRequestSystemRequired) };
            let _ = unsafe { CloseHandle(handle) };
        }
    }

    pub struct WakeListener {
        registration: HPOWERNOTIFY,
        parameters: usize,
        context: usize,
    }

    unsafe impl Send for WakeListener {}
    unsafe impl Sync for WakeListener {}

    pub fn install_wake_listener(inhibitor: SleepInhibitor) -> Result<WakeListener, String> {
        let context = Box::into_raw(Box::new(inhibitor));
        let parameters = Box::into_raw(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(power_notification_callback),
            Context: context.cast(),
        }));
        let mut registration_raw: *mut c_void = std::ptr::null_mut();
        let result = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                HANDLE(parameters.cast()),
                &mut registration_raw,
            )
        };
        if result != WIN32_ERROR(0) {
            unsafe {
                drop(Box::from_raw(parameters));
                drop(Box::from_raw(context));
            }
            return Err(format!(
                "could not register wake notifications: {}",
                result.0
            ));
        }
        Ok(WakeListener {
            registration: HPOWERNOTIFY(registration_raw as isize),
            parameters: parameters as usize,
            context: context as usize,
        })
    }

    unsafe extern "system" fn power_notification_callback(
        context: *const c_void,
        event_type: u32,
        _setting: *const c_void,
    ) -> u32 {
        if [
            PBT_APMRESUMEAUTOMATIC,
            PBT_APMRESUMECRITICAL,
            PBT_APMRESUMESTANDBY,
            PBT_APMRESUMESUSPEND,
        ]
        .contains(&event_type)
        {
            if let Some(inhibitor) = unsafe { (context as *const SleepInhibitor).as_ref() } {
                inhibitor.refresh_after_wake();
            }
        }
        0
    }

    impl Drop for WakeListener {
        fn drop(&mut self) {
            let _ = unsafe { PowerUnregisterSuspendResumeNotification(self.registration) };
            unsafe {
                drop(Box::from_raw(
                    self.parameters as *mut DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS,
                ));
                drop(Box::from_raw(self.context as *mut SleepInhibitor));
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{PowerBackend, SleepInhibitor};
    use block2::RcBlock;
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use std::ptr::NonNull;

    const K_IO_RETURN_SUCCESS: i32 = 0;

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        static kIOPMAssertionTypePreventUserIdleSystemSleep: CFStringRef;
        fn IOPMAssertionCreateWithDescription(
            assertion_type: CFStringRef,
            name: CFStringRef,
            details: CFStringRef,
            human_readable_reason: CFStringRef,
            localization_bundle_path: CFStringRef,
            timeout: f64,
            timeout_action: CFStringRef,
            assertion_id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }

    #[derive(Default)]
    pub struct SystemPowerBackend {
        assertion_id: Option<u32>,
    }

    impl PowerBackend for SystemPowerBackend {
        fn acquire(&mut self) -> Result<(), String> {
            if self.assertion_id.is_some() {
                return Ok(());
            }
            let name = CFString::new("YTLoadster is downloading media");
            let mut assertion_id = 0;
            let result = unsafe {
                IOPMAssertionCreateWithDescription(
                    kIOPMAssertionTypePreventUserIdleSystemSleep,
                    name.as_concrete_TypeRef(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    0.0,
                    std::ptr::null(),
                    &mut assertion_id,
                )
            };
            if result != K_IO_RETURN_SUCCESS {
                return Err(format!("IOKit returned {result}"));
            }
            self.assertion_id = Some(assertion_id);
            Ok(())
        }

        fn release(&mut self) {
            if let Some(assertion_id) = self.assertion_id.take() {
                let _ = unsafe { IOPMAssertionRelease(assertion_id) };
            }
        }
    }

    pub struct WakeListener;

    pub fn install_wake_listener(inhibitor: SleepInhibitor) -> Result<WakeListener, String> {
        let workspace = NSWorkspace::sharedWorkspace();
        let center: objc2::rc::Retained<NSNotificationCenter> = workspace.notificationCenter();
        let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            inhibitor.refresh_after_wake();
        });
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWorkspaceDidWakeNotification),
                None,
                None,
                &block,
            )
        };
        std::mem::forget(observer);
        Ok(WakeListener)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::{PowerBackend, SleepInhibitor};

    #[derive(Default)]
    pub struct SystemPowerBackend;

    impl PowerBackend for SystemPowerBackend {
        fn acquire(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn release(&mut self) {}
    }

    pub struct WakeListener;

    pub fn install_wake_listener(_inhibitor: SleepInhibitor) -> Result<WakeListener, String> {
        Ok(WakeListener)
    }
}

pub use platform::WakeListener;

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Metrics {
        acquired: usize,
        released: usize,
    }

    struct RecordingBackend {
        metrics: Arc<Mutex<Metrics>>,
    }

    impl PowerBackend for RecordingBackend {
        fn acquire(&mut self) -> Result<(), String> {
            self.metrics.lock().unwrap().acquired += 1;
            Ok(())
        }

        fn release(&mut self) {
            self.metrics.lock().unwrap().released += 1;
        }
    }

    fn inhibitor(enabled: bool) -> (SleepInhibitor, Arc<Mutex<Metrics>>) {
        let metrics = Arc::new(Mutex::new(Metrics::default()));
        let inhibitor = SleepInhibitor::with_backend(
            enabled,
            Box::new(RecordingBackend {
                metrics: metrics.clone(),
            }),
        );
        (inhibitor, metrics)
    }

    #[test]
    fn disabled_preference_does_not_create_a_request() {
        let (inhibitor, metrics) = inhibitor(false);
        let guard = inhibitor.begin_download();
        drop(guard);

        let metrics = metrics.lock().unwrap();
        assert_eq!(metrics.acquired, 0);
        assert_eq!(metrics.released, 0);
    }

    #[test]
    fn parallel_downloads_share_one_request() {
        let (inhibitor, metrics) = inhibitor(true);
        let first = inhibitor.begin_download();
        let second = inhibitor.begin_download();
        assert_eq!(metrics.lock().unwrap().acquired, 1);

        drop(first);
        assert_eq!(metrics.lock().unwrap().released, 0);
        drop(second);
        assert_eq!(metrics.lock().unwrap().released, 1);
    }

    #[test]
    fn preference_changes_apply_while_a_download_is_running() {
        let (inhibitor, metrics) = inhibitor(false);
        let guard = inhibitor.begin_download();
        inhibitor.set_enabled(true);
        assert_eq!(metrics.lock().unwrap().acquired, 1);
        inhibitor.set_enabled(false);
        assert_eq!(metrics.lock().unwrap().released, 1);
        drop(guard);
    }

    #[test]
    fn wake_refresh_replaces_an_active_request() {
        let (inhibitor, metrics) = inhibitor(true);
        let guard = inhibitor.begin_download();
        inhibitor.refresh_after_wake();

        let metrics = metrics.lock().unwrap();
        assert_eq!(metrics.acquired, 2);
        assert_eq!(metrics.released, 1);
        drop(metrics);
        drop(guard);
    }
}
