//! OAuth 2.0 PKCE engine for provider authentication.
//!
//! Supports the Authorization Code flow with PKCE (S256) and device-code flow.
//! Tokens are stored in the OS keyring via the `keyring` crate.
//!
//! Built-in provider configs: GitHub, Google, Microsoft (Azure).
//! Custom providers can be passed at runtime.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

// ─── Built-in OAuth providers ───────────────────────────────────────────

/// Well-known OAuth provider configurations.
pub static BUILTIN_PROVIDERS: LazyLock<Vec<OAuthProviderConfig>> = LazyLock::new(|| {
    vec![
        OAuthProviderConfig {
            id: "github".into(),
            name: "GitHub".into(),
            auth_url: "https://github.com/login/oauth/authorize".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            client_id: None, // dynamic — user provides or we use default
            scopes: vec!["repo".into(), "user".into()],
            default_redirect_port: 48912,
            use_pkce: true,
        },
        OAuthProviderConfig {
            id: "google".into(),
            name: "Google".into(),
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            client_id: None,
            scopes: vec!["openid".into(), "email".into(), "https://www.googleapis.com/auth/cloud-platform".into()],
            default_redirect_port: 48913,
            use_pkce: true,
        },
        OAuthProviderConfig {
            id: "azure".into(),
            name: "Microsoft (Azure)".into(),
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
            client_id: None,
            scopes: vec!["openid".into(), "offline_access".into(), "https://cognitiveservices.azure.com/.default".into()],
            default_redirect_port: 48914,
            use_pkce: true,
        },
    ]
});

// ─── Types ──────────────────────────────────────────────────────────────

/// Anti-forgery states handed out by `oauth_build_auth_url` and consumed by
/// `oauth_exchange`. A state absent here (never issued, already used, or forged)
/// causes the exchange to be refused, closing the CSRF gap where an attacker's
/// authorization code could be exchanged against a victim's client.
static PENDING_STATES: LazyLock<Mutex<std::collections::HashSet<String>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthProviderConfig {
    pub id: String,
    pub name: String,
    pub auth_url: String,
    pub token_url: String,
    pub client_id: Option<String>,
    pub scopes: Vec<String>,
    pub default_redirect_port: u16,
    pub use_pkce: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkcePair {
    pub code_verifier: String,
    pub code_challenge: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix epoch seconds when this token expires (best-effort).
    pub expires_at: Option<u64>,
    pub token_type: String,
    pub scope: Option<String>,
    /// The provider id this token belongs to.
    pub provider_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUrlRequest {
    pub provider_id: String,
    /// Optional override for the provider's client_id. Falls back to the config default.
    pub client_id: Option<String>,
    /// Optional redirect URI override. Defaults to `http://127.0.0.1:{port}/callback`.
    pub redirect_uri: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUrlResponse {
    pub url: String,
    pub state: String,
    pub code_verifier: Option<String>,
    pub redirect_port: u16,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExchangeRequest {
    pub provider_id: String,
    pub code: String,
    pub code_verifier: Option<String>,
    pub redirect_uri: String,
    pub client_id: Option<String>,
    /// Anti-forgery state returned by `oauth_build_auth_url`. The caller must
    /// echo the exact value it received; a mismatch is rejected to prevent
    /// CSRF-driven authorization-code injection.
    pub state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshRequest {
    pub provider_id: String,
    pub refresh_token: String,
    pub client_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthProviderStatus {
    pub id: String,
    pub name: String,
    pub has_token: bool,
    pub token_preview: Option<String>,
}

// ─── PKCE ───────────────────────────────────────────────────────────────

/// Generate a cryptographically random code verifier (43–128 chars).
pub fn generate_code_verifier() -> String {
    let bytes: Vec<u8> = (0..64).map(|_| rand::thread_rng().gen::<u8>()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Compute the S256 code challenge for a given verifier.
pub fn code_challenge_s256(verifier: &str) -> String {
    let hash = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hash)
}

/// Create a PKCE pair.
pub fn generate_pkce_pair() -> PkcePair {
    let code_verifier = generate_code_verifier();
    let code_challenge = code_challenge_s256(&code_verifier);
    PkcePair {
        code_verifier,
        code_challenge,
    }
}

// ─── State ──────────────────────────────────────────────────────────────

/// Generate a random anti-forgery state token (base64, 32 bytes).
pub fn generate_state() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen::<u8>()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

// ─── Local redirect server ──────────────────────────────────────────────

/// Start a minimal HTTP server on `127.0.0.1:{port}`, listen for exactly ONE
/// GET request at `/callback`, extract the `?code=` parameter, and return it.
///
/// Returns an error if the port is unavailable or no valid callback arrives
/// within `timeout_secs`.
fn listen_for_callback(port: u16, timeout_secs: u64) -> Result<String, String> {
    let addr = format!("127.0.0.1:{port}");
    let listener =
        TcpListener::bind(&addr).map_err(|e| format!("Cannot bind to {addr}: {e}"))?;

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Cannot set non-blocking: {e}"))?;

    let deadline = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + timeout_secs;

    loop {
        if SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            > deadline
        {
            return Err("OAuth callback timed out. No authorization response received.".into());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                reader
                    .read_line(&mut request_line)
                    .map_err(|e| format!("Failed to read HTTP request: {e}"))?;

                // Read headers to find Content-Length and consume body
                let mut headers = HashMap::new();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 || header.trim().is_empty() {
                        break;
                    }
                    if let Some((key, value)) = header.split_once(':') {
                        headers.insert(key.trim().to_lowercase(), value.trim().to_string());
                    }
                }

                // Parse the request line: "GET /callback?code=... HTTP/1.1"
                let parts: Vec<&str> = request_line.split_whitespace().collect();
                if parts.len() < 2 {
                    respond_http(&mut stream, 400, "Bad Request");
                    return Err("Invalid HTTP request line".into());
                }

                let path = parts[1];
                let query_start = path.find('?');

                let code = match query_start {
                    Some(pos) => {
                        let query_str = &path[pos + 1..];
                        let params: HashMap<String, String> = query_str
                            .split('&')
                            .filter_map(|pair| {
                                let mut parts = pair.splitn(2, '=');
                                match (parts.next(), parts.next()) {
                                    (Some(k), Some(v)) => {
                                        Some((urlencoding_decode(k), urlencoding_decode(v)))
                                    }
                                    _ => None,
                                }
                            })
                            .collect();

                        params.get("code").cloned().ok_or_else(|| {
                            "OAuth callback missing 'code' parameter".to_string()
                        })?
                    }
                    None => {
                        respond_http(&mut stream, 400, "Missing query parameters");
                        return Err("OAuth callback missing query string".into());
                    }
                };

                respond_http(
                    &mut stream,
                    200,
                    "<html><body><h1>✓ Authorized</h1><p>You can close this window and return to Whim.</p></body></html>",
                );

                return Ok(code);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(format!("HTTP accept error: {e}")),
        }
    }
}

fn respond_http(stream: &mut impl Write, status: u16, body: &str) {
    let status_line = match status {
        200 => "200 OK",
        400 => "400 Bad Request",
        500 => "500 Internal Server Error",
        _ => "200 OK",
    };
    let headers = format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

fn urlencoding_decode(input: &str) -> String {
    // Manual percent-decode (avoid adding the `url` crate dep for this)
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

// ─── Token exchange ─────────────────────────────────────────────────────

/// Exchange an authorization code for tokens via POST to the token endpoint.
async fn exchange_code(
    config: &OAuthProviderConfig,
    code: &str,
    code_verifier: Option<&str>,
    redirect_uri: &str,
    client_id: &str,
) -> Result<OAuthToken, String> {
    let mut params: Vec<(&str, String)> = vec![
        ("grant_type", "authorization_code".into()),
        ("code", code.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("client_id", client_id.to_string()),
    ];

    if let Some(verifier) = code_verifier {
        params.push(("code_verifier", verifier.to_string()));
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&config.token_url)
        .form(&params)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    if !status.is_success() {
        let err_desc = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Token exchange failed ({status}): {err_desc}"));
    }

    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Token response missing access_token".to_string())?
        .to_string();

    let expires_in = body.get("expires_in").and_then(|v| v.as_u64());
    let expires_at = expires_in.map(|secs| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + secs
    });

    Ok(OAuthToken {
        access_token,
        refresh_token: body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        expires_at,
        token_type: body
            .get("token_type")
            .and_then(|v| v.as_str())
            .unwrap_or("Bearer")
            .to_string(),
        scope: body.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
        provider_id: config.id.clone(),
    })
}

/// Refresh an access token using a refresh token.
async fn refresh_token(
    config: &OAuthProviderConfig,
    refresh_token: &str,
    client_id: &str,
) -> Result<OAuthToken, String> {
    let params: Vec<(&str, String)> = vec![
        ("grant_type", "refresh_token".into()),
        ("refresh_token", refresh_token.to_string()),
        ("client_id", client_id.to_string()),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post(&config.token_url)
        .form(&params)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;

    if !status.is_success() {
        let err_desc = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Token refresh failed ({status}): {err_desc}"));
    }

    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Refresh response missing access_token".to_string())?
        .to_string();

    let expires_in = body.get("expires_in").and_then(|v| v.as_u64());
    let expires_at = expires_in.map(|secs| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + secs
    });

    Ok(OAuthToken {
        access_token,
        refresh_token: body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(refresh_token.to_string())), // keep old refresh token if none returned
        expires_at,
        token_type: body
            .get("token_type")
            .and_then(|v| v.as_str())
            .unwrap_or("Bearer")
            .to_string(),
        scope: body.get("scope").and_then(|v| v.as_str()).map(|s| s.to_string()),
        provider_id: config.id.clone(),
    })
}

// ─── Keyring storage ────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "workwhim-ide-oauth";

fn keyring_entry_name(provider_id: &str) -> String {
    format!("oauth-token:{provider_id}")
}

/// Store a token in the OS keyring.
fn store_token(token: &OAuthToken) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_entry_name(&token.provider_id))
        .map_err(|e| format!("Keyring entry creation failed: {e}"))?;

    let json = serde_json::to_string(token).map_err(|e| format!("Token serialization failed: {e}"))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("Keyring set failed: {e}"))
}

/// Load a stored token from the OS keyring (public for callers).
pub async fn get_stored_token(provider_id: &str) -> Option<OAuthToken> {
    load_stored_token(provider_id).ok().flatten()
}

/// Load a stored token from the OS keyring.
fn load_stored_token(provider_id: &str) -> Result<Option<OAuthToken>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_entry_name(provider_id))
        .map_err(|e| format!("Keyring entry creation failed: {e}"))?;

    match entry.get_password() {
        Ok(json) => {
            let token: OAuthToken =
                serde_json::from_str(&json).map_err(|e| format!("Token deserialization failed: {e}"))?;
            Ok(Some(token))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring get failed: {e}")),
    }
}

/// Delete a stored token.
fn delete_stored_token(provider_id: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &keyring_entry_name(provider_id))
        .map_err(|e| format!("Keyring entry creation failed: {e}"))?;

    entry
        .delete_credential()
        .map_err(|e| format!("Keyring delete failed: {e}"))
}

/// Get a resolved client_id for a provider. Uses the passed override, then
/// the config default, then the env var `{PROVIDER_ID}_OAUTH_CLIENT_ID`.
fn resolve_client_id(provider_id: &str, override_id: Option<&str>, config: &OAuthProviderConfig) -> String {
    if let Some(id) = override_id {
        if !id.trim().is_empty() {
            return id.to_string();
        }
    }
    if let Some(ref id) = config.client_id {
        if !id.trim().is_empty() {
            return id.to_string();
        }
    }
    // Check env var: GITHUB_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_ID, etc.
    let env_var = format!("{}_OAUTH_CLIENT_ID", provider_id.to_uppercase());
    std::env::var(&env_var).unwrap_or_default()
}

// ─── Tauri commands ─────────────────────────────────────────────────────

/// List built-in OAuth providers and their stored-token status.
#[tauri::command]
pub fn oauth_list_providers() -> Vec<OAuthProviderStatus> {
    BUILTIN_PROVIDERS
        .iter()
        .map(|config| {
            let has_token = load_stored_token(&config.id).ok().flatten().is_some();
            let token_preview = load_stored_token(&config.id)
                .ok()
                .flatten()
                .map(|t| {
                    let preview: String = t.access_token.chars().take(8).collect();
                    format!("{preview}…")
                });
            OAuthProviderStatus {
                id: config.id.clone(),
                name: config.name.clone(),
                has_token,
                token_preview,
            }
        })
        .collect()
}

/// Build the authorization URL and return it with the PKCE data.
/// The caller opens the URL in the user's browser.
///
/// After the user authorizes, call `oauth_exchange` with the returned code.
#[tauri::command]
pub fn oauth_build_auth_url(
    req: AuthUrlRequest,
) -> Result<AuthUrlResponse, String> {
    let config = BUILTIN_PROVIDERS
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("Unknown OAuth provider: {}", req.provider_id))?;

    let client_id = resolve_client_id(&req.provider_id, req.client_id.as_deref(), config);
    if client_id.is_empty() {
        let env_var = format!("{}_OAUTH_CLIENT_ID", req.provider_id.to_uppercase());
        return Err(format!(
            "No OAuth client_id for {provider}. Set the {env_var} environment variable or pass client_id.",
            provider = config.name,
            env_var = env_var
        ));
    }

    let port = config.default_redirect_port;
    let redirect_uri = req.redirect_uri.unwrap_or(format!("http://127.0.0.1:{port}/callback"));

    let state = generate_state();
    PENDING_STATES
        .lock()
        .map_err(|error| format!("OAuth state registry is poisoned: {error}"))?
        .insert(state.clone());
    let pkce = if config.use_pkce {
        Some(generate_pkce_pair())
    } else {
        None
    };

    let mut url = Url::parse(&config.auth_url).map_err(|e| format!("Invalid auth URL: {e}"))?;

    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state);

    if !config.scopes.is_empty() {
        let scope_str = config.scopes.join(" ");
        url.query_pairs_mut().append_pair("scope", &scope_str);
    }

    if let Some(ref pkce) = pkce {
        url.query_pairs_mut()
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &pkce.code_challenge);
    }

    Ok(AuthUrlResponse {
        url: url.to_string(),
        state,
        code_verifier: pkce.map(|p| p.code_verifier),
        redirect_port: port,
        redirect_uri,
    })
}

/// Start the full OAuth flow in one step:
/// 1. Find/start a local HTTP server
/// 2. Open the authorization URL in the user's browser  
/// 3. Wait for the callback
/// 4. Exchange the code for tokens
/// 5. Store the token in the keyring
///
/// This is a blocking command — the Tauri runtime runs it on a thread pool.
#[tauri::command]
pub async fn oauth_authorize(
    req: AuthUrlRequest,
) -> Result<OAuthToken, String> {
    let config = BUILTIN_PROVIDERS
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("Unknown OAuth provider: {}", req.provider_id))?;

    let client_id = resolve_client_id(&req.provider_id, req.client_id.as_deref(), config);
    if client_id.is_empty() {
        let env_var = format!("{}_OAUTH_CLIENT_ID", req.provider_id.to_uppercase());
        return Err(format!(
            "No OAuth client_id for {provider}. Set the {env_var} environment variable or pass client_id.",
            provider = config.name,
            env_var = env_var
        ));
    }

    let port = config.default_redirect_port;
    let redirect_uri = req.redirect_uri.unwrap_or(format!("http://127.0.0.1:{port}/callback"));

    // Generate PKCE
    let state = generate_state();
    let pkce = if config.use_pkce {
        Some(generate_pkce_pair())
    } else {
        None
    };

    // Build the auth URL
    let mut url = Url::parse(&config.auth_url).map_err(|e| format!("Invalid auth URL: {e}"))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state);

    if !config.scopes.is_empty() {
        let scope_str = config.scopes.join(" ");
        url.query_pairs_mut().append_pair("scope", &scope_str);
    }

    if let Some(ref pkce) = pkce {
        url.query_pairs_mut()
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &pkce.code_challenge);
    }

    // Open the browser
    let url_str = url.to_string();
    if let Err(e) = open_url_in_browser(&url_str) {
        return Err(format!("Failed to open browser: {e}. Open the URL manually:\n{url_str}"));
    }

    // Wait for the callback. The local redirect server is a blocking listener, so
    // run it on a dedicated blocking thread rather than the async executor (it
    // would otherwise stall a Tokio worker for the whole 300s authorization window).
    let code: String = match port_check(&port) {
        Ok(true) => {
            let cb = tauri::async_runtime::spawn_blocking(move || listen_for_callback(port, 300))
                .await
                .map_err(|error| format!("OAuth callback thread panicked: {error}"))??;
            cb
        }
        _ => {
            // Port might be in use — try a random port
            let fallback_port = find_available_port(48915, 49000)?;
            let fallback_uri = format!("http://127.0.0.1:{fallback_port}/callback");
            return Err(format!(
                "Default redirect port {port} is unavailable. Try again with:\n  redirect_uri: {fallback_uri}"
            ));
        }
    };

    // Exchange code for token
    let code_verifier = pkce.as_ref().map(|p| p.code_verifier.as_str());
    let token = exchange_code(config, &code, code_verifier, &redirect_uri, &client_id).await?;

    // Store in keyring
    store_token(&token)?;

    Ok(token)
}

/// Exchange an authorization code for a token (without storing it).
#[tauri::command]
pub async fn oauth_exchange(req: ExchangeRequest) -> Result<OAuthToken, String> {
    let config = BUILTIN_PROVIDERS
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("Unknown OAuth provider: {}", req.provider_id))?;

    let client_id = resolve_client_id(&req.provider_id, req.client_id.as_deref(), config);
    if client_id.is_empty() {
        return Err(format!(
            "No OAuth client_id for {provider}",
            provider = config.name
        ));
    }

    // CSRF guard: the caller must echo the exact anti-forgery `state` it was
    // given by `oauth_build_auth_url`. The expected value is held server-side in
    // `PENDING_STATES` from the moment the auth URL was built, so a stolen
    // authorization code from a different session is rejected instead of
    // exchanged.
    let provided = req
        .state
        .ok_or_else(|| "OAuth CSRF state was not supplied; refusing token exchange.".to_string())?;
    {
        let mut pending = PENDING_STATES
            .lock()
            .map_err(|error| format!("OAuth state registry is poisoned: {error}"))?;
        if !pending.remove(&provided) {
            return Err(
                "OAuth CSRF state did not match a pending authorization request; refusing token exchange.".into(),
            );
        }
    }

    exchange_code(
        config,
        &req.code,
        req.code_verifier.as_deref(),
        &req.redirect_uri,
        &client_id,
    )
    .await
}

/// Refresh a stored token.
#[tauri::command]
pub async fn oauth_refresh(req: RefreshRequest) -> Result<OAuthToken, String> {
    let config = BUILTIN_PROVIDERS
        .iter()
        .find(|p| p.id == req.provider_id)
        .ok_or_else(|| format!("Unknown OAuth provider: {}", req.provider_id))?;

    let client_id = resolve_client_id(&req.provider_id, req.client_id.as_deref(), config);
    if client_id.is_empty() {
        return Err(format!(
            "No OAuth client_id for {provider}",
            provider = config.name
        ));
    }

    let token = refresh_token(config, &req.refresh_token, &client_id).await?;

    // Store updated token
    store_token(&token)?;

    Ok(token)
}

/// Get the stored token (masked) for a provider.
#[tauri::command]
pub fn oauth_get_token(provider_id: String) -> Result<Option<OAuthToken>, String> {
    load_stored_token(&provider_id)
}

/// Clear the stored token for a provider.
#[tauri::command]
pub fn oauth_clear_token(provider_id: String) -> Result<(), String> {
    delete_stored_token(&provider_id)
}

// ─── Helpers ────────────────────────────────────────────────────────────

fn port_check(port: &u16) -> Result<bool, String> {
    let addr = format!("127.0.0.1:{port}");
    match TcpListener::bind(&addr) {
        Ok(_) => Ok(true), // port is free
        Err(_) => Ok(false),
    }
}

fn find_available_port(start: u16, end: u16) -> Result<u16, String> {
    for port in start..=end {
        if port_check(&port)? {
            return Ok(port);
        }
    }
    Err(format!("No available port in range {start}–{end}"))
}

/// Open a URL in the default browser.
pub(crate) fn open_url_in_browser(url: &str) -> Result<(), String> {
    open::that(url).map_err(|e| format!("Failed to open browser: {e}"))
}
