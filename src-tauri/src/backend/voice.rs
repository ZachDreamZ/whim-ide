use serde::{Deserialize, Serialize};
use std::{net::IpAddr, time::Duration};

const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
const MAX_SPEECH_CHARS: usize = 4_096;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub audio: Vec<u8>,
    pub mime_type: Option<String>,
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechRequest {
    pub text: String,
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub voice: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub text: String,
}

fn provider_name(value: Option<&str>) -> String {
    let requested = value
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("openai");
    if requested != "auto" {
        return requested.to_string();
    }
    if std::env::var("OPENAI_API_KEY").is_ok_and(|key| !key.trim().is_empty()) {
        "openai".into()
    } else if std::env::var("OLLAMA_HOST").is_ok() || std::env::var("LM_STUDIO_BASE_URL").is_ok() {
        "local".into()
    } else {
        "openai".into()
    }
}
fn api_key(provider: &str, explicit: Option<String>) -> Result<Option<String>, String> {
    if let Some(key) = explicit.filter(|key| !key.trim().is_empty()) {
        return Ok(Some(key));
    }
    let variable = match provider {
        "openai" => Some("OPENAI_API_KEY"),
        "compatible" => Some("OPENAI_API_KEY"),
        "local" => None,
        _ => {
            return Err(format!(
                "Provider '{provider}' does not expose an OpenAI-compatible voice API"
            ))
        }
    };
    Ok(variable
        .and_then(|name| std::env::var(name).ok())
        .filter(|key| !key.trim().is_empty()))
}
fn voice_base(provider: &str, value: Option<String>) -> Result<String, String> {
    let raw = value.unwrap_or_else(|| {
        if provider == "local" {
            "http://127.0.0.1:1234/v1".into()
        } else {
            "https://api.openai.com/v1".into()
        }
    });
    let url =
        reqwest::Url::parse(raw.trim()).map_err(|_| "Voice base URL is invalid".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Voice base URL must not contain embedded credentials".into());
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Voice base URL must use HTTP or HTTPS".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Voice base URL has no host".to_string())?;
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if provider == "local" && !loopback {
        return Err("Local voice endpoints must use loopback".into());
    }
    if provider != "local" && url.scheme() != "https" {
        return Err("Remote voice endpoints must use HTTPS".into());
    }
    if provider != "local"
        && host
            .parse::<IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || is_private(ip))
    {
        return Err("Remote voice endpoints cannot target private or loopback addresses".into());
    }
    Ok(raw.trim_end_matches('/').to_string())
}
fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
        }
        IpAddr::V6(ip) => {
            ip.is_unique_local()
                || ip.is_loopback()
                || ip.is_unicast_link_local()
                || ip.is_unspecified()
        }
    }
}
fn endpoint(base: &str, suffix: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), suffix)
}
async fn client(base: &str, provider: &str) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none());
    let url = reqwest::Url::parse(base).map_err(|_| "Voice base URL is invalid".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "Voice base URL has no host".to_string())?;
    if provider != "local" && host.parse::<IpAddr>().is_err() {
        let port = url
            .port_or_known_default()
            .ok_or_else(|| "Voice endpoint has no port".to_string())?;
        let addresses = tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| format!("Voice endpoint DNS lookup failed: {error}"))?
            .collect::<Vec<_>>();
        if addresses.is_empty() || addresses.iter().any(|address| is_private(address.ip())) {
            return Err(
                "Remote voice endpoint DNS resolved to a private or loopback address".into(),
            );
        }
        builder = builder.resolve(host, addresses[0]);
    }
    builder.build().map_err(|error| error.to_string())
}
fn extension(mime: &str) -> Result<&'static str, String> {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "audio/webm" => Ok("webm"),
        "audio/ogg" => Ok("ogg"),
        "audio/wav" | "audio/x-wav" => Ok("wav"),
        "audio/mpeg" => Ok("mp3"),
        "audio/flac" => Ok("flac"),
        _ => Err("Unsupported voice recording format".into()),
    }
}
async fn response_error(response: reqwest::Response, label: &str) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    format!(
        "{label} returned {status}: {}",
        body.chars().take(2_000).collect::<String>()
    )
}

#[tauri::command]
pub async fn transcribe_voice(request: TranscribeRequest) -> Result<Transcript, String> {
    if request.audio.is_empty() {
        return Err("Recorded audio is empty".into());
    }
    if request.audio.len() > MAX_AUDIO_BYTES {
        return Err("Recorded audio exceeds the 25 MB limit".into());
    }
    let provider = provider_name(request.provider.as_deref());
    let base = voice_base(&provider, request.base_url)?;
    let key = api_key(&provider, request.api_key)?;
    if provider != "local" && key.is_none() {
        return Err(format!("No voice API key is configured for {provider}"));
    }
    let mime = request.mime_type.as_deref().unwrap_or("audio/webm");
    let ext = extension(mime)?;
    let part = reqwest::multipart::Part::bytes(request.audio)
        .file_name(format!("voice.{ext}"))
        .mime_str(mime)
        .map_err(|error| error.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", request.model.unwrap_or_else(|| "whisper-1".into()));
    if let Some(language) = request
        .language
        .filter(|language| !language.trim().is_empty() && language != "auto")
    {
        if !["en", "es", "fr", "de", "ja", "zh"].contains(&language.as_str()) {
            return Err("Unsupported transcription language".into());
        }
        form = form.text("language", language);
    }
    let mut builder = client(&base, &provider)
        .await?
        .post(endpoint(&base, "audio/transcriptions"))
        .multipart(form);
    if let Some(key) = key {
        builder = builder.bearer_auth(key);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("Voice transcription failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Voice transcription").await);
    }
    response
        .json::<Transcript>()
        .await
        .map_err(|error| format!("Invalid transcription response: {error}"))
}

#[tauri::command]
pub async fn synthesize_voice(request: SpeechRequest) -> Result<Vec<u8>, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err("Speech text is empty".into());
    }
    if text.chars().count() > MAX_SPEECH_CHARS {
        return Err("Speech text exceeds the 4096-character limit".into());
    }
    let provider = provider_name(request.provider.as_deref());
    let base = voice_base(&provider, request.base_url)?;
    let key = api_key(&provider, request.api_key)?;
    if provider != "local" && key.is_none() {
        return Err(format!("No voice API key is configured for {provider}"));
    }
    let mut builder = client(&base, &provider).await?.post(endpoint(&base, "audio/speech")).json(&serde_json::json!({"model": request.model.unwrap_or_else(|| "gpt-4o-mini-tts".into()), "voice": request.voice.unwrap_or_else(|| "alloy".into()), "input": text, "response_format": "mp3"}));
    if let Some(key) = key {
        builder = builder.bearer_auth(key);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("Speech synthesis failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response_error(response, "Speech synthesis").await);
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("Generated speech exceeds the 25 MB limit".into());
    }
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_voice_endpoints_and_formats() {
        // Remote HTTPS endpoint is accepted.
        assert!(voice_base("openai", Some("https://api.openai.com/v1".into())).is_ok());
        // Non-loopback HTTP to a cloud provider is rejected (cleartext).
        assert!(voice_base("openai", Some("http://api.openai.com/v1".into())).is_err());
        // Loopback HTTP is rejected for cloud providers.
        assert!(voice_base("openai", Some("http://127.0.0.1/v1".into())).is_err());
        // Local provider may use a loopback HTTP endpoint.
        assert!(voice_base("local", Some("http://127.0.0.1:9000/v1".into())).is_ok());
        // Embedded credentials are rejected.
        assert!(voice_base("openai", Some("https://user:pass@api.openai.com/v1".into())).is_err());
        assert_eq!(extension("audio/ogg; codecs=opus").unwrap(), "ogg");
        assert!(extension("video/mp4").is_err());
    }
}
