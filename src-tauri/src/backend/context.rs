use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

use super::{workspace::selected_workspace_path, BackendState};

const MAX_CONTEXT_CHARS: usize = 16_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppContextRequest {
    pub source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppContextResult {
    pub source: String,
    pub available: bool,
    pub message: String,
    pub content: Option<String>,
    pub path: Option<String>,
    pub content_kind: String,
}

#[cfg(windows)]
fn hidden_powershell(script: &str, environment: &[(&str, &str)]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    for (name, value) in environment {
        command.env(name, value);
    }
    let output = command
        .output()
        .map_err(|error| format!("Could not start the Windows context adapter: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "The Windows context adapter did not return content.".into()
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(not(windows))]
fn hidden_powershell(_script: &str, _environment: &[(&str, &str)]) -> Result<String, String> {
    Err("Desktop context capture is currently available on Windows only.".into())
}

fn read_window(source: &str) -> Result<AppContextResult, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$wanted = if ($env:WHIM_CONTEXT_SOURCE -eq 'vscode') { @('Code') } else { @('WindowsTerminal','wezterm-gui','pwsh','powershell','cmd') }
$process = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $wanted -contains $_.ProcessName } | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $process) { throw "No visible $($env:WHIM_CONTEXT_SOURCE) window was found." }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("Window: $($root.Current.Name)")
$elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($element in $elements) {
  if ($lines.Count -ge 1200) { break }
  try {
    $valuePattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      $value = $valuePattern.Current.Value
      if (-not [string]::IsNullOrWhiteSpace($value)) { $lines.Add($value) }
    } elseif (-not [string]::IsNullOrWhiteSpace($element.Current.Name)) {
      $lines.Add($element.Current.Name)
    }
  } catch {}
}
$text = ($lines | Select-Object -Unique) -join "`n"
if ($text.Length -gt 16000) { $text = $text.Substring(0,16000) + "`n[context truncated]" }
$text
"#;
    let content = hidden_powershell(script, &[("WHIM_CONTEXT_SOURCE", source)])?;
    if content.trim().is_empty() {
        return Err(format!(
            "The {source} window was found but exposed no readable UI Automation text."
        ));
    }
    Ok(AppContextResult {
        source: source.into(),
        available: true,
        message: format!("Captured visible text from {source}. Review it before sending."),
        content: Some(content.chars().take(MAX_CONTEXT_CHARS).collect()),
        path: None,
        content_kind: "text".into(),
    })
}

fn capture_screenshot(workspace: &Path) -> Result<AppContextResult, String> {
    let directory = workspace.join(".whim").join("context");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the context folder: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = directory.join(format!("screenshot-{stamp}.png"));
    let path_text = path.to_string_lossy().into_owned();
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
  $bitmap.Save($env:WHIM_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
"#;
    hidden_powershell(script, &[("WHIM_SCREENSHOT_PATH", &path_text)])?;
    if !path.is_file() {
        return Err("Windows reported success but no screenshot was created.".into());
    }
    Ok(AppContextResult {
        source: "screenshot".into(),
        available: true,
        message:
            "Captured the current desktop. The image path will be included with your next request."
                .into(),
        content: None,
        path: Some(path_text),
        content_kind: "image".into(),
    })
}

/// Reads another app only after the user explicitly selects a context source.
/// PowerShell is launched with CREATE_NO_WINDOW so capture never flashes a console.
#[tauri::command]
pub fn capture_app_context(
    state: State<'_, BackendState>,
    request: AppContextRequest,
) -> Result<AppContextResult, String> {
    match request.source.as_str() {
        "vscode" | "terminal" => read_window(&request.source),
        "screenshot" => capture_screenshot(&selected_workspace_path(state.inner())?),
        _ => Err("Unknown desktop context source".into()),
    }
}
