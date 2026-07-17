use serde::Serialize;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const BROWSER_LABEL: &str = "whim-browser";
const DEFAULT_BROWSER_URL: &str = "https://www.google.com";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBrowserState {
    pub open: bool,
    pub url: Option<String>,
}

fn browser_url_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn parse_browser_url(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 2_048 || raw.chars().any(char::is_control) {
        return Err("Enter a valid web address".into());
    }
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = Url::parse(&candidate).map_err(|_| "Enter a valid web address".to_string())?;
    browser_url_allowed(&url)
        .then_some(url)
        .ok_or_else(|| "Whim Browser only opens normal http or https addresses".into())
}

fn state_for(app: &AppHandle) -> NativeBrowserState {
    let Some(window) = app.get_webview_window(BROWSER_LABEL) else {
        return NativeBrowserState {
            open: false,
            url: None,
        };
    };
    NativeBrowserState {
        open: true,
        url: window.url().ok().map(|url| url.to_string()),
    }
}

fn show_or_create(app: &AppHandle, url: Url) -> Result<NativeBrowserState, String> {
    if let Some(window) = app.get_webview_window(BROWSER_LABEL) {
        window.navigate(url).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(state_for(app));
    }

    WebviewWindowBuilder::new(app, BROWSER_LABEL, WebviewUrl::External(url))
        .title("Whim Browser")
        .inner_size(1_120.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .incognito(false)
        .devtools(false)
        .on_navigation(browser_url_allowed)
        .build()
        .map_err(|error| format!("Could not open Whim Browser: {error}"))?;
    Ok(state_for(app))
}

#[tauri::command]
pub async fn native_browser_action(
    app: AppHandle,
    action: String,
    url: Option<String>,
) -> Result<NativeBrowserState, String> {
    match action.as_str() {
        "open" | "navigate" => {
            let url = parse_browser_url(url.as_deref().unwrap_or(DEFAULT_BROWSER_URL))?;
            show_or_create(&app, url)
        }
        "back" | "forward" => {
            let window = app
                .get_webview_window(BROWSER_LABEL)
                .ok_or_else(|| "Whim Browser is not open".to_string())?;
            let script = if action == "back" {
                "history.back()"
            } else {
                "history.forward()"
            };
            window.eval(script).map_err(|error| error.to_string())?;
            Ok(state_for(&app))
        }
        "reload" => {
            let window = app
                .get_webview_window(BROWSER_LABEL)
                .ok_or_else(|| "Whim Browser is not open".to_string())?;
            window.reload().map_err(|error| error.to_string())?;
            Ok(state_for(&app))
        }
        "focus" => {
            let window = app
                .get_webview_window(BROWSER_LABEL)
                .ok_or_else(|| "Whim Browser is not open".to_string())?;
            window.show().map_err(|error| error.to_string())?;
            window.set_focus().map_err(|error| error.to_string())?;
            Ok(state_for(&app))
        }
        "close" => {
            if let Some(window) = app.get_webview_window(BROWSER_LABEL) {
                window.close().map_err(|error| error.to_string())?;
            }
            Ok(state_for(&app))
        }
        "state" => Ok(state_for(&app)),
        _ => Err("Unsupported browser action".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_urls_are_normalized_and_restricted() {
        assert_eq!(
            parse_browser_url("example.com/docs")
                .expect("valid url")
                .as_str(),
            "https://example.com/docs"
        );
        assert!(parse_browser_url("file:///C:/Windows/System32").is_err());
        assert!(parse_browser_url("javascript:alert(1)").is_err());
        assert!(parse_browser_url("https://user:pass@example.com").is_err());
    }
}
