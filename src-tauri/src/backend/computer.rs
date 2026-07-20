use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use windows::core::{Interface, BSTR};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationInvokePattern,
    IUIAutomationTogglePattern,     IUIAutomationValuePattern, ToggleState_Off, TreeScope_Descendants,
    UIA_InvokePatternId, UIA_TogglePatternId, UIA_ValuePatternId,
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
    pub bounding_rectangle: Option<[i32; 4]>,
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

// RAII guard: initializes COM on construction and uninitializes it on drop.
// Previously each helper called CoUninitialize() directly, which tore down the
// COM apartment on the calling thread (and could fire RPC_E_WRONG_THREAD on the
// next UI Automation call). This keeps init/uninit balanced per operation.
struct ComGuard;
impl ComGuard {
    fn init() -> Result<ComGuard, String> {
        // S_FALSE (already initialized) is acceptable; only a hard error (e.g.
        // RPC_E_CHANGED_MODE) should abort. `CoInitializeEx` returns Ok(()) for
        // both S_OK and S_FALSE in the windows crate, so `.ok()` suffices.
        unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED).ok(); };
        Ok(ComGuard)
    }
}
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

static REF_COUNTER: AtomicUsize = AtomicUsize::new(0);
const MAX_UI_ELEMENTS: i32 = 250;

fn get_automation() -> Result<(ComGuard, IUIAutomation), String> {
    let _guard = ComGuard::init()?;
    let automation: IUIAutomation = unsafe {
        windows::core::Interface::cast(
            &windows::Win32::System::Com::CoCreateInstance::<_, IUIAutomation>(
                &CUIAutomation,
                None,
                windows::Win32::System::Com::CLSCTX_INPROC_SERVER,
            )
            .map_err(|e| format!("Failed to create CUIAutomation: {}", e))?,
        )
        .map_err(|e| format!("Failed to cast CUIAutomation: {}", e))?
    };
    Ok((_guard, automation))
}

// Map a UIA control-type id to a human-readable name. Without this the agent
// only saw `Type_<number>`, which is unusable for reasoning about the UI.
fn control_type_name(id: i32) -> String {
    let name = match id {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "DataGrid",
        50027 => "DataItem",
        50028 => "Document",
        50029 => "Group",
        50030 => "Header",
        50031 => "HeaderItem",
        50032 => "Pane",
        50033 => "Separator",
        50034 => "SplitButton",
        50035 => "Window",
        50036 => "AppBar",
        50037 => "SemanticZoom",
        50038 => "Thumb",
        _ => return format!("Type_{}", id),
    };
    name.to_string()
}

// Best-effort extract the element's current text value via the Value pattern
// (Edit/Document/ComboBox selections), falling back to its accessible name.
fn element_text(element: &IUIAutomationElement) -> Option<String> {
    unsafe {
        if let Ok(pattern) = element.GetCurrentPattern(UIA_ValuePatternId) {
            if let Ok(value) = pattern.cast::<IUIAutomationValuePattern>() {
                if let Ok(bstr) = value.CurrentValue() {
                    let text = bstr.to_string();
                    if !text.is_empty() {
                        return Some(text);
                    }
                }
            }
        }
        let name = element.CurrentName().unwrap_or_default().to_string();
        if !name.is_empty() {
            Some(name)
        } else {
            None
        }
    }
}

pub fn computer_inspect() -> Result<UIState, String> {
    let (_guard, automation) = get_automation()?;
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

        let total = children.Length().unwrap_or(0);
        let count = total.clamp(0, MAX_UI_ELEMENTS);
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

                // Skip nameless, id-less leaf noise, but keep structural elements
                // (groups/windows) since they help the agent orient.
                let ctype_name = control_type_name(ctype.0);
                if el_name.is_empty() && auto_id.is_empty() && ctype_name == "Custom" {
                    continue;
                }

                // Capture a text value when the element exposes one (e.g. Edit,
                // Document, ComboBox selections) so the agent can read state.
                let translated_text = element_text(&child).filter(|s| !s.is_empty());

                let rect = child
                    .CurrentBoundingRectangle()
                    .ok()
                    .map(|r| [r.left, r.top, r.right - r.left, r.bottom - r.top]);

                cache.insert(ref_id.clone(), SyncElement(child.clone()));

                elements.push(UIElement {
                    ref_id,
                    name: el_name,
                    control_type: ctype_name,
                    automation_id: auto_id,
                    is_enabled: enabled,
                    is_keyboard_focusable: focusable,
                    translated_text,
                    bounding_rectangle: rect,
                    source: "accessibility".to_string(),
                });
            }
        }

        Ok(UIState {
            window_title: name,
            elements,
        })
    }
}

// Try to (re)locate a cached element. If it has gone stale (e.g. the cache was
// cleared by a newer inspect), re-run an inspection of the foreground window so
// the agent's verify loop can still resolve the ref instead of failing hard.
fn resolve_element(ref_id: &str) -> Result<IUIAutomationElement, String> {
    {
        let cache = ELEMENT_CACHE
            .lock()
            .map_err(|error| format!("Desktop element cache is unavailable: {error}"))?;
        if let Some(element) = cache.get(ref_id) {
            return Ok(element.0.clone());
        }
    }
    // Stale ref: refresh and retry once.
    let _ = computer_inspect();
    let cache = ELEMENT_CACHE
        .lock()
        .map_err(|error| format!("Desktop element cache is unavailable: {error}"))?;
    cache
        .get(ref_id)
        .map(|s| s.0.clone())
        .ok_or_else(|| format!("Element {} not found or stale", ref_id))
}

pub fn computer_invoke(ref_id: &str) -> Result<(), String> {
    let (_guard, _automation) = get_automation()?;
    let element = resolve_element(ref_id)?;

    unsafe {
        // Prefer Invoke (buttons, menu items, hyperlinks). Fall back to Toggle
        // for checkboxes/radio buttons that expose no Invoke pattern.
        if let Ok(pattern) = element.GetCurrentPattern(UIA_InvokePatternId) {
            if let Ok(invoke) = pattern.cast::<IUIAutomationInvokePattern>() {
                return invoke.Invoke().map_err(|e| e.to_string());
            }
        }
        if let Ok(pattern) = element.GetCurrentPattern(UIA_TogglePatternId) {
            if let Ok(toggle) = pattern.cast::<IUIAutomationTogglePattern>() {
                return toggle.Toggle().map_err(|e| e.to_string());
            }
        }
        Err(format!(
            "Element {} does not support Invoke or Toggle patterns",
            ref_id
        ))
    }
}

pub fn computer_set_value(ref_id: &str, text: &str) -> Result<(), String> {
    let (_guard, _automation) = get_automation()?;
    let element = resolve_element(ref_id)?;

    unsafe {
        if let Ok(pattern) = element.GetCurrentPattern(UIA_ValuePatternId) {
            if let Ok(value) = pattern.cast::<IUIAutomationValuePattern>() {
                return value
                    .SetValue(&BSTR::from(text))
                    .map_err(|e| e.to_string());
            }
        }
        Err(format!(
            "Element {} does not support setting a value (not an editable field)",
            ref_id
        ))
    }
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

    let mut command = std::process::Command::new(&program);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
        .spawn()
        .map_err(|e| format!("Failed to launch {}: {}", program.display(), e))?;
    Ok(())
}

#[tauri::command]
pub fn open_gpt_section(section: String) -> Result<(), String> {
    if !matches!(
        section.as_str(),
        "Scheduled" | "Plugins" | "Sites" | "Pull requests" | "Chat"
    ) {
        return Err("Unsupported GPT section".into());
    }
    let (_guard, automation) = get_automation()?;
    unsafe {
        let root = automation
            .GetRootElement()
            .map_err(|error| error.to_string())?;
        let condition = automation
            .CreateTrueCondition()
            .map_err(|error| error.to_string())?;
        let windows = root
            .FindAll(TreeScope_Descendants, &condition)
            .map_err(|error| error.to_string())?;
        let mut found_target = false;
        for index in 0..windows.Length().unwrap_or(0) {
            let Ok(candidate) = windows.GetElement(index) else {
                continue;
            };
            // Match any window whose title contains the section's app context
            // rather than hard-coding "ChatGPT" — keeps working if the user
            // renames or uses a different branded build.
            let title = candidate.CurrentName().unwrap_or(BSTR::new()).to_string();
            if !title.to_lowercase().contains("chat") && !title.to_lowercase().contains("gpt") {
                continue;
            }
            found_target = true;
            let Ok(descendants) = candidate.FindAll(TreeScope_Descendants, &condition) else {
                continue;
            };
            for descendant_index in 0..descendants.Length().unwrap_or(0).min(5_000) {
                let Ok(descendant) = descendants.GetElement(descendant_index) else {
                    continue;
                };
                if descendant.CurrentName().unwrap_or(BSTR::new()) != section.as_str() {
                    continue;
                }
                if let Ok(pattern) = descendant.GetCurrentPattern(UIA_InvokePatternId) {
                    if let Ok(pattern) = pattern.cast::<IUIAutomationInvokePattern>() {
                        return pattern.Invoke().map_err(|error| error.to_string());
                    }
                }
                if section == "Chat" {
                    if let Ok(pattern) = descendant.GetCurrentPattern(UIA_TogglePatternId) {
                        if let Ok(pattern) = pattern.cast::<IUIAutomationTogglePattern>() {
                            if pattern.CurrentToggleState().map_err(|error| error.to_string())?
                                == ToggleState_Off
                            {
                                return pattern.Toggle().map_err(|error| error.to_string());
                            }
                            return Ok(());
                        }
                    }
                }
            }
        }
        if !found_target {
            return Err("Open the GPT desktop app, then try again".into());
        }
    }
    Err(format!(
        "Could not find the {section} page in the GPT desktop app"
    ))
}
