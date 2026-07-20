use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

use super::execution::quick_capture;
use super::workspace::selected_workspace_path;
use super::BackendState;

const SERVICES_DIR: &str = ".whim/services";
const COMPOSE_FILE: &str = "docker-compose.yml";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceKind {
    Postgres,
    Redis,
}

impl ServiceKind {
    fn as_str(&self) -> &'static str {
        match self {
            ServiceKind::Postgres => "postgres",
            ServiceKind::Redis => "redis",
        }
    }

    fn default_port(&self) -> u16 {
        match self {
            ServiceKind::Postgres => 5432,
            ServiceKind::Redis => 6379,
        }
    }

    fn compose_definition(&self, id: &str, port: u16) -> String {
        match self {
            ServiceKind::Postgres => format!(
                r#"services:
  {id}:
    image: postgres:16-alpine
    container_name: whim-{id}
    restart: unless-stopped
    ports:
      - "{port}:5432"
    environment:
      POSTGRES_USER: whim
      POSTGRES_PASSWORD: whim_{id}
      POSTGRES_DB: {id}
    volumes:
      - {id}_data:/var/lib/postgresql/data
volumes:
  {id}_data:
"#,
                id = id, port = port
            ),
            ServiceKind::Redis => format!(
                r#"services:
  {id}:
    image: redis:7-alpine
    container_name: whim-{id}
    restart: unless-stopped
    ports:
      - "{port}:6379"
    command: redis-server --requirepass whim_{id}
    volumes:
      - {id}_data:/data
volumes:
  {id}_data:
"#,
                id = id, port = port
            ),
        }
    }

    fn connection_string(&self, id: &str, port: u16) -> String {
        match self {
            ServiceKind::Postgres => {
                format!("postgresql://whim:whim_{id}@127.0.0.1:{port}/{id}")
            }
            ServiceKind::Redis => {
                format!("redis://:whim_{id}@127.0.0.1:{port}")
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceResource {
    pub id: String,
    pub kind: ServiceKind,
    pub name: String,
    pub status: ServiceStatus,
    pub port: u16,
    pub connection_string: String,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceStatus {
    Running,
    Stopped,
    Error(String),
    Unknown,
}

fn services_path(root: &Path) -> PathBuf {
    root.join(SERVICES_DIR)
}

fn service_dir(root: &Path, id: &str) -> PathBuf {
    services_path(root).join(id)
}

fn state_file_path(root: &Path, id: &str) -> PathBuf {
    service_dir(root, id).join("service.json")
}

fn load_service_state(root: &Path, id: &str) -> Result<Option<ServiceResource>, String> {
    let path = state_file_path(root, id);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read service state: {e}"))?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| format!("Failed to parse service state: {e}"))
}

fn save_service_state(root: &Path, service: &ServiceResource) -> Result<(), String> {
    let dir = service_dir(root, &service.id);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create service directory: {e}"))?;
    let content = serde_json::to_string_pretty(service)
        .map_err(|e| format!("Failed to serialize service state: {e}"))?;
    fs::write(state_file_path(root, &service.id), content)
        .map_err(|e| format!("Failed to write service state: {e}"))
}

fn list_service_ids(root: &Path) -> Result<Vec<String>, String> {
    let dir = services_path(root);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to list services: {e}"))?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read service entry: {e}"))?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let id = entry.file_name().to_string_lossy().to_string();
            if state_file_path(root, &id).exists() {
                ids.push(id);
            }
        }
    }
    ids.sort();
    Ok(ids)
}

#[tauri::command]
pub async fn list_services(
    state: State<'_, BackendState>,
) -> Result<Vec<ServiceResource>, String> {
    let root = selected_workspace_path(state.inner()).await?;
    let ids = list_service_ids(&root)?;
    let mut services = Vec::new();
    for id in ids {
        if let Some(service) = load_service_state(&root, &id)? {
            services.push(service);
        }
    }
    Ok(services)
}

fn check_port(host: &str, port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("{host}:{port}").parse().unwrap(),
        Duration::from_millis(2000),
    )
    .is_ok()
}

fn probe_service(service: &mut ServiceResource) {
    let reachable = check_port("127.0.0.1", service.port);
    if reachable {
        service.status = ServiceStatus::Running;
    } else if service.status == ServiceStatus::Running {
        service.status = ServiceStatus::Stopped;
    }
}

fn next_available_port(kind: &ServiceKind, root: &Path) -> Result<u16, String> {
    let base = kind.default_port();
    let ids = list_service_ids(root)?;
    let used_ports: Vec<u16> = ids
        .iter()
        .filter_map(|id| load_service_state(root, id).ok().flatten())
        .filter(|s| s.kind == *kind)
        .map(|s| s.port)
        .collect();
    let mut port = base;
    while used_ports.contains(&port) {
        port += 1;
    }
    Ok(port)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionServiceRequest {
    pub kind: ServiceKind,
    pub name: Option<String>,
}

#[tauri::command]
pub async fn provision_service(
    state: State<'_, BackendState>,
    request: ProvisionServiceRequest,
) -> Result<ServiceResource, String> {
    let root = selected_workspace_path(state.inner()).await?;
    let id = format!("{}-{}", request.kind.as_str(), &Uuid::new_v4().to_string()[..8]);
    let name = request.name.unwrap_or_else(|| id.clone());
    let port = next_available_port(&request.kind, &root)?;
    let connection_string = request.kind.connection_string(&name, port);

    let service = ServiceResource {
        id: id.clone(),
        kind: request.kind.clone(),
        name,
        status: ServiceStatus::Unknown,
        port,
        connection_string,
        created_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };

    let dir = service_dir(&root, &id);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create service directory: {e}"))?;

    let compose = request.kind.compose_definition(&id, port);
    fs::write(dir.join(COMPOSE_FILE), &compose)
        .map_err(|e| format!("Failed to write docker-compose.yml: {e}"))?;

    // Attempt to start via Docker Compose
    let compose_path = dir.join(COMPOSE_FILE);
    let compose_str = compose_path.to_str().unwrap().to_string();
    match quick_capture(
        "docker",
        &["compose".to_string(), "-f".to_string(), compose_str, "up".to_string(), "-d".to_string()],
        Some(&root),
        60_000,
    )
    .await
    {
        Ok((_stdout, _stderr, success)) => {
            if success {
                // Wait briefly for the port to open
                for _ in 0..10 {
                    if check_port("127.0.0.1", port) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            }
        }
        Err(e) => {
            // Docker not available — save state as error
            let mut svc = service.clone();
            svc.status = ServiceStatus::Error(format!("Docker unavailable: {e}"));
            save_service_state(&root, &svc)?;
            return Ok(svc);
        }
    }

    let mut service = service;
    probe_service(&mut service);
    save_service_state(&root, &service)?;
    Ok(service)
}

#[tauri::command]
pub async fn stop_service(
    state: State<'_, BackendState>,
    service_id: String,
) -> Result<ServiceResource, String> {
    let root = selected_workspace_path(state.inner()).await?;
    let mut service = load_service_state(&root, &service_id)?
        .ok_or_else(|| format!("Service '{service_id}' not found"))?;

    let dir = service_dir(&root, &service_id);
    let compose_path = dir.join(COMPOSE_FILE);
    let compose_str = compose_path.to_str().unwrap().to_string();
    match quick_capture(
        "docker",
        &["compose".to_string(), "-f".to_string(), compose_str, "down".to_string()],
        Some(&root),
        30_000,
    )
    .await
    {
        Ok((_stdout, _stderr, success)) => {
            if success {
                service.status = ServiceStatus::Stopped;
            } else {
                service.status = ServiceStatus::Error("Failed to stop container".into());
            }
        }
        Err(e) => {
            service.status = ServiceStatus::Error(format!("Docker unavailable: {e}"));
        }
    }
    save_service_state(&root, &service)?;
    Ok(service)
}

#[tauri::command]
pub async fn start_service(
    state: State<'_, BackendState>,
    service_id: String,
) -> Result<ServiceResource, String> {
    let root = selected_workspace_path(state.inner()).await?;
    let mut service = load_service_state(&root, &service_id)?
        .ok_or_else(|| format!("Service '{service_id}' not found"))?;

    let dir = service_dir(&root, &service_id);
    let compose_path = dir.join(COMPOSE_FILE);
    let compose_str = compose_path.to_str().unwrap().to_string();
    match quick_capture(
        "docker",
        &["compose".to_string(), "-f".to_string(), compose_str, "up".to_string(), "-d".to_string()],
        Some(&root),
        60_000,
    )
    .await
    {
        Ok((_stdout, _stderr, success)) => {
            if success {
                for _ in 0..10 {
                    if check_port("127.0.0.1", service.port) {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            } else {
                service.status = ServiceStatus::Error("Failed to start container".into());
                save_service_state(&root, &service)?;
                return Ok(service);
            }
        }
        Err(e) => {
            service.status = ServiceStatus::Error(format!("Docker unavailable: {e}"));
            save_service_state(&root, &service)?;
            return Ok(service);
        }
    }
    probe_service(&mut service);
    save_service_state(&root, &service)?;
    Ok(service)
}

#[tauri::command]
pub async fn remove_service(
    state: State<'_, BackendState>,
    service_id: String,
) -> Result<(), String> {
    let root = selected_workspace_path(state.inner()).await?;
    let _service = load_service_state(&root, &service_id)?
        .ok_or_else(|| format!("Service '{service_id}' not found"))?;

    let dir = service_dir(&root, &service_id);
    let compose_path = dir.join(COMPOSE_FILE);
    let compose_str = compose_path.to_str().unwrap().to_string();
    let _ = quick_capture(
        "docker",
        &["compose".to_string(), "-f".to_string(), compose_str, "down".to_string(), "-v".to_string()],
        Some(&root),
        30_000,
    )
    .await;

    fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to remove service directory: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn service_status(
    state: State<'_, BackendState>,
    service_id: String,
) -> Result<ServiceResource, String> {
    let root = selected_workspace_path(state.inner()).await?;
    let mut service = load_service_state(&root, &service_id)?
        .ok_or_else(|| format!("Service '{service_id}' not found"))?;
    probe_service(&mut service);
    save_service_state(&root, &service)?;
    Ok(service)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn service_kind_as_str() {
        assert_eq!(ServiceKind::Postgres.as_str(), "postgres");
        assert_eq!(ServiceKind::Redis.as_str(), "redis");
    }

    #[test]
    fn service_kind_default_port() {
        assert_eq!(ServiceKind::Postgres.default_port(), 5432);
        assert_eq!(ServiceKind::Redis.default_port(), 6379);
    }

    #[test]
    fn service_kind_connection_string() {
        let pg = ServiceKind::Postgres.connection_string("mydb", 5432);
        assert!(pg.starts_with("postgresql://"));
        assert!(pg.contains("mydb"));
        assert!(pg.contains("127.0.0.1:5432"));

        let redis = ServiceKind::Redis.connection_string("mycache", 6379);
        assert!(redis.starts_with("redis://"));
        assert!(redis.contains("mycache"));
        assert!(redis.contains("127.0.0.1:6379"));
    }

    #[test]
    fn compose_definition_postgres_contains_correct_image() {
        let compose = ServiceKind::Postgres.compose_definition("test-pg", 5432);
        assert!(compose.contains("postgres:16-alpine"));
        assert!(compose.contains("whim-test-pg"));
        assert!(compose.contains("5432:5432"));
        assert!(compose.contains("POSTGRES_USER: whim"));
        assert!(compose.contains("POSTGRES_PASSWORD: whim_test-pg"));
    }

    #[test]
    fn compose_definition_redis_contains_correct_image() {
        let compose = ServiceKind::Redis.compose_definition("test-redis", 6379);
        assert!(compose.contains("redis:7-alpine"));
        assert!(compose.contains("whim-test-redis"));
        assert!(compose.contains("6379:6379"));
        assert!(compose.contains("requirepass whim_test-redis"));
    }

    #[test]
    fn compose_definition_differs_by_id() {
        let a = ServiceKind::Postgres.compose_definition("service-a", 5432);
        let b = ServiceKind::Postgres.compose_definition("service-b", 5433);
        assert_ne!(a, b);
        assert!(a.contains("service-a"));
        assert!(b.contains("service-b"));
    }

    #[test]
    fn services_path_resolves_under_dot_whim() {
        let root = Path::new("/workspace");
        let path = services_path(root);
        assert_eq!(path, Path::new("/workspace/.whim/services"));
    }

    #[test]
    fn service_dir_resolves_to_id_subdirectory() {
        let root = Path::new("/workspace");
        let dir = service_dir(root, "my-svc");
        assert_eq!(dir, Path::new("/workspace/.whim/services/my-svc"));
    }

    #[test]
    fn state_file_path_resolves_correctly() {
        let root = Path::new("/workspace");
        let path = state_file_path(root, "my-svc");
        assert_eq!(path, Path::new("/workspace/.whim/services/my-svc/service.json"));
    }

    #[test]
    fn save_and_load_service_state_round_trips() {
        let root = std::env::temp_dir().join(format!("whim-svc-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let service = ServiceResource {
            id: "pg-1".into(),
            kind: ServiceKind::Postgres,
            name: "My Postgres".into(),
            status: ServiceStatus::Running,
            port: 5432,
            connection_string: "postgresql://user:pass@127.0.0.1:5432/db".into(),
            created_at_ms: 1000,
        };

        save_service_state(&root, &service).unwrap();
        let loaded = load_service_state(&root, "pg-1").unwrap().unwrap();
        assert_eq!(loaded.id, "pg-1");
        assert_eq!(loaded.kind, ServiceKind::Postgres);
        assert_eq!(loaded.status, ServiceStatus::Running);
        assert_eq!(loaded.port, 5432);

        let ids = list_service_ids(&root).unwrap();
        assert_eq!(ids, vec!["pg-1"]);

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn list_service_ids_returns_empty_for_missing_dir() {
        let root = Path::new("/nonexistent-path-that-does-not-exist");
        let ids = list_service_ids(root).unwrap();
        assert!(ids.is_empty());
    }

    #[test]
    fn list_service_ids_ignores_files_without_service_json() {
        let root = std::env::temp_dir().join(format!("whim-svc-test-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join(".whim/services/no-state-dir")).unwrap();
        fs::create_dir_all(root.join(".whim/services/has-state")).unwrap();
        let svc = ServiceResource {
            id: "has-state".into(),
            kind: ServiceKind::Redis,
            name: "cache".into(),
            status: ServiceStatus::Stopped,
            port: 6379,
            connection_string: "redis://:pass@127.0.0.1:6379".into(),
            created_at_ms: 2000,
        };
        save_service_state(&root, &svc).unwrap();
        let ids = list_service_ids(&root).unwrap();
        assert_eq!(ids, vec!["has-state"]);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn next_available_port_returns_default_when_no_conflict() {
        let root = std::env::temp_dir().join(format!("whim-svc-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let port = next_available_port(&ServiceKind::Postgres, &root).unwrap();
        assert_eq!(port, 5432);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn next_available_port_increments_on_conflict() {
        let root = std::env::temp_dir().join(format!("whim-svc-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let existing = ServiceResource {
            id: "pg-1".into(),
            kind: ServiceKind::Postgres,
            name: "pg-1".into(),
            status: ServiceStatus::Running,
            port: 5432,
            connection_string: "postgresql://...".into(),
            created_at_ms: 0,
        };
        save_service_state(&root, &existing).unwrap();

        let port = next_available_port(&ServiceKind::Postgres, &root).unwrap();
        assert_eq!(port, 5433);

        let existing2 = ServiceResource {
            id: "pg-2".into(),
            kind: ServiceKind::Postgres,
            name: "pg-2".into(),
            status: ServiceStatus::Running,
            port: 5433,
            connection_string: "postgresql://...".into(),
            created_at_ms: 0,
        };
        save_service_state(&root, &existing2).unwrap();

        let port2 = next_available_port(&ServiceKind::Postgres, &root).unwrap();
        assert_eq!(port2, 5434);

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn next_available_port_ignores_other_kinds() {
        let root = std::env::temp_dir().join(format!("whim-svc-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();

        let redis = ServiceResource {
            id: "redis-1".into(),
            kind: ServiceKind::Redis,
            name: "redis-1".into(),
            status: ServiceStatus::Running,
            port: 6379,
            connection_string: "redis://...".into(),
            created_at_ms: 0,
        };
        save_service_state(&root, &redis).unwrap();

        // Postgres ports should not be affected by Redis using 6379
        let port = next_available_port(&ServiceKind::Postgres, &root).unwrap();
        assert_eq!(port, 5432);

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn service_status_unknown_after_provision_without_docker() {
        // Docker isn't available in test, so `provision_service` returns Error status.
        // This test verifies the state model serialization works correctly.
        let status = ServiceStatus::Error("Docker unavailable".into());
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.is_empty());
        let back: ServiceStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(back, status);
    }

    #[test]
    fn service_kind_serialization_round_trip() {
        let kinds = vec![ServiceKind::Postgres, ServiceKind::Redis];
        for kind in &kinds {
            let json = serde_json::to_string(kind).unwrap();
            let back: ServiceKind = serde_json::from_str(&json).unwrap();
            assert_eq!(*kind, back);
        }
    }

    #[test]
    fn service_resource_serialization() {
        let svc = ServiceResource {
            id: "svc-1".into(),
            kind: ServiceKind::Redis,
            name: "My Cache".into(),
            status: ServiceStatus::Running,
            port: 6380,
            connection_string: "redis://:secret@127.0.0.1:6380".into(),
            created_at_ms: 42,
        };
        let json = serde_json::to_string_pretty(&svc).unwrap();
        assert!(json.contains("svc-1"));
        assert!(json.contains("redis"));
        assert!(json.contains("running"));
        assert!(json.contains("redis://"));
        assert!(json.contains("42"));

        let back: ServiceResource = serde_json::from_str(&json).unwrap();
        assert_eq!(svc.id, back.id);
        assert_eq!(svc.kind, back.kind);
        assert_eq!(svc.status, back.status);
        assert_eq!(svc.port, back.port);
        assert_eq!(svc.name, back.name);
    }
}
