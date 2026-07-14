use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use windows::core::{Interface, BSTR};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    TreeScope_Descendants, UIA_InvokePatternId,
};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UIElement {
    pub ref_id: String,
    pub name: String,
    pub control_type: String,
    pub automation_id: String,
    pub is_enabled: bool,
    pub is_keyboard_focusable: bool,
    pub translated_text: Option<String>,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UIState {
    pub window_title: String,
    pub elements: Vec<UIElement>,
}

lazy_static::lazy_static! {
    static ref ELEMENT_CACHE: Mutex<HashMap<String, SyncElement>> = Mutex::new(HashMap::new());
}

struct SyncElement(IUIAutomationElement);
unsafe impl Send for SyncElement {}
unsafe impl Sync for SyncElement {}

static REF_COUNTER: AtomicUsize = AtomicUsize::new(0);
const MAX_UI_ELEMENTS: i32 = 250;

fn get_automation() -> Result<IUIAutomation, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        windows::core::Interface::cast(
            &windows::Win32::System::Com::CoCreateInstance::<_, IUIAutomation>(
                &CUIAutomation,
                None,
                windows::Win32::System::Com::CLSCTX_INPROC_SERVER,
            )
            .map_err(|e| format!("Failed to create CUIAutomation: {}", e))?,
        )
        .map_err(|e| format!("Failed to cast CUIAutomation: {}", e))
    }
}

pub fn computer_inspect() -> Result<UIState, String> {
    let automation = get_automation()?;
    let mut cache = ELEMENT_CACHE
        .lock()
        .map_err(|error| format!("Desktop element cache is unavailable: {error}"))?;
    cache.clear();

    unsafe {
        let root = automation
            .GetRootElement()
            .map_err(|e| format!("Failed to get root element: {}", e))?;
        let foreground = GetForegroundWindow();

        let target_window = if !foreground.is_invalid() {
            automation.ElementFromHandle(foreground).unwrap_or(root)
        } else {
            root
        };

        let name = target_window
            .CurrentName()
            .unwrap_or(BSTR::new())
            .to_string();

        let condition = automation
            .CreateTrueCondition()
            .map_err(|e| e.to_string())?;
        let children = target_window
            .FindAll(TreeScope_Descendants, &condition)
            .map_err(|e| e.to_string())?;

        let count = children.Length().unwrap_or(0).min(MAX_UI_ELEMENTS);
        let mut elements = Vec::new();

        for i in 0..count {
            if let Ok(child) = children.GetElement(i) {
                let ref_id = format!("u{}", REF_COUNTER.fetch_add(1, Ordering::SeqCst));

                let el_name = child.CurrentName().unwrap_or(BSTR::new()).to_string();
                let auto_id = child
                    .CurrentAutomationId()
                    .unwrap_or(BSTR::new())
                    .to_string();
                let ctype = child
                    .CurrentControlType()
                    .unwrap_or(windows::Win32::UI::Accessibility::UIA_CONTROLTYPE_ID(0));
                let enabled = child
                    .CurrentIsEnabled()
                    .unwrap_or(windows::Win32::Foundation::BOOL(0))
                    .as_bool();
                let focusable = child
                    .CurrentIsKeyboardFocusable()
                    .unwrap_or(windows::Win32::Foundation::BOOL(0))
                    .as_bool();

                if el_name.is_empty() && auto_id.is_empty() {
                    continue;
                }

                cache.insert(ref_id.clone(), SyncElement(child.clone()));

                elements.push(UIElement {
                    ref_id,
                    name: el_name,
                    control_type: format!("Type_{}", ctype.0),
                    automation_id: auto_id,
                    is_enabled: enabled,
                    is_keyboard_focusable: focusable,
                    translated_text: None,
                    source: "accessibility".to_string(),
                });
            }
        }

        let _ = CoUninitialize();

        Ok(UIState {
            window_title: name,
            elements,
        })
    }
}

pub fn computer_invoke(ref_id: &str) -> Result<(), String> {
    let _automation = get_automation()?;
    let cache = ELEMENT_CACHE
        .lock()
        .map_err(|error| format!("Desktop element cache is unavailable: {error}"))?;
    let element = cache
        .get(ref_id)
        .map(|s| s.0.clone())
        .ok_or_else(|| format!("Element {} not found or stale", ref_id))?;

    unsafe {
        let pattern: IUIAutomationInvokePattern = element
            .GetCurrentPattern(UIA_InvokePatternId)
            .map_err(|e| e.to_string())?
            .cast()
            .map_err(|e| e.to_string())?;

        pattern.Invoke().map_err(|e| e.to_string())?;
        let _ = CoUninitialize();
    }

    Ok(())
}

pub fn computer_launch(path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err("Desktop launch requires a printable executable path".into());
    }

    let candidate = Path::new(path);
    let program = if candidate.is_absolute() || candidate.components().count() > 1 {
        let resolved = dunce::canonicalize(candidate)
            .map_err(|error| format!("Desktop launch target is unavailable: {error}"))?;
        if !resolved.is_file() {
            return Err("Desktop launch target must be a file".into());
        }
        resolved
    } else {
        PathBuf::from(path)
    };
    if let Some(extension) = program.extension().and_then(|value| value.to_str()) {
        if !matches!(extension.to_ascii_lowercase().as_str(), "exe" | "com") {
            return Err("Desktop launch only accepts Windows executables".into());
        }
    }

    std::process::Command::new(&program)
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", program.display(), e))?;
    Ok(())
}
