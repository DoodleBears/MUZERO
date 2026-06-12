use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

const EVENT_NAME: &str = "live-request-message";
const DEFAULT_MAX_BODY_BYTES: usize = 256 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub struct LiveRequestIntakeState {
    server: Mutex<Option<LiveRequestServer>>,
}

struct LiveRequestServer {
    port: u16,
    shutdown: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRequestIntakeStartRequest {
    port: u16,
    token: String,
    max_body_bytes: Option<usize>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveRequestIntakeStatus {
    supported: bool,
    listening: bool,
    port: Option<u16>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveRequestIntakePayload {
    body: String,
    received_at: u64,
}

#[tauri::command]
pub fn start_live_request_intake(
    app: AppHandle,
    state: State<'_, LiveRequestIntakeState>,
    request: LiveRequestIntakeStartRequest,
) -> Result<LiveRequestIntakeStatus, String> {
    let token = request.token.trim().to_string();
    if token.is_empty() {
        return Err("Live request intake token is required.".to_string());
    }

    let mut guard = state
        .server
        .lock()
        .map_err(|_| "Live request intake lock poisoned.")?;
    if let Some(previous) = guard.as_mut() {
        stop_server(previous);
    }
    *guard = None;

    let listener = TcpListener::bind(("127.0.0.1", request.port)).map_err(|err| err.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|err| err.to_string())?;
    let port = listener.local_addr().map_err(|err| err.to_string())?.port();
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = Arc::clone(&shutdown);
    let max_body_bytes = request.max_body_bytes.unwrap_or(DEFAULT_MAX_BODY_BYTES);
    let handle = thread::spawn(move || {
        run_server(listener, app, token, max_body_bytes, thread_shutdown);
    });

    *guard = Some(LiveRequestServer {
        port,
        shutdown,
        join: Some(handle),
    });

    Ok(LiveRequestIntakeStatus {
        supported: true,
        listening: true,
        port: Some(port),
        error: None,
    })
}

#[tauri::command]
pub fn stop_live_request_intake(
    state: State<'_, LiveRequestIntakeState>,
) -> Result<LiveRequestIntakeStatus, String> {
    let mut guard = state
        .server
        .lock()
        .map_err(|_| "Live request intake lock poisoned.")?;
    if let Some(mut server) = guard.take() {
        stop_server(&mut server);
    }
    Ok(LiveRequestIntakeStatus {
        supported: true,
        listening: false,
        port: None,
        error: None,
    })
}

#[tauri::command]
pub fn live_request_intake_status(
    state: State<'_, LiveRequestIntakeState>,
) -> Result<LiveRequestIntakeStatus, String> {
    let guard = state
        .server
        .lock()
        .map_err(|_| "Live request intake lock poisoned.")?;
    Ok(LiveRequestIntakeStatus {
        supported: true,
        listening: guard.is_some(),
        port: guard.as_ref().map(|server| server.port),
        error: None,
    })
}

fn stop_server(server: &mut LiveRequestServer) {
    server.shutdown.store(true, Ordering::Relaxed);
    if let Some(join) = server.join.take() {
        let _ = join.join();
    }
}

fn run_server(
    listener: TcpListener,
    app: AppHandle,
    token: String,
    max_body_bytes: usize,
    shutdown: Arc<AtomicBool>,
) {
    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _addr)) => handle_stream(stream, &app, &token, max_body_bytes),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn handle_stream(mut stream: TcpStream, app: &AppHandle, token: &str, max_body_bytes: usize) {
    let response = match read_http_request(&mut stream, max_body_bytes) {
        Ok(request) => route_http_request(request, app, token),
        Err(message) => http_response(400, "Bad Request", &json_message(false, &message)),
    };
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn route_http_request(request: HttpRequest, app: &AppHandle, token: &str) -> String {
    if request.method == "GET" && request.path == "/health" {
        return http_response(200, "OK", r#"{"ok":true,"app":"MUZERO","apiVersion":1}"#);
    }

    if request.method != "POST" || request.path != "/v1/audience/request" {
        return http_response(404, "Not Found", &json_message(false, "not found"));
    }

    if !is_authorized(&request, token) {
        return http_response(401, "Unauthorized", &json_message(false, "unauthorized"));
    }

    let payload = LiveRequestIntakePayload {
        body: request.body,
        received_at: now_millis(),
    };
    let _ = app.emit(EVENT_NAME, payload);
    http_response(202, "Accepted", r#"{"accepted":true,"status":"queued"}"#)
}

fn read_http_request(stream: &mut TcpStream, max_body_bytes: usize) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|err| err.to_string())?;
    let mut buffer = Vec::new();
    let mut temp = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut temp).map_err(|err| err.to_string())?;
        if read == 0 {
            return Err("connection closed before headers completed".to_string());
        }
        buffer.extend_from_slice(&temp[..read]);
        if buffer.len() > MAX_HEADER_BYTES + max_body_bytes {
            return Err("request exceeded maximum size".to_string());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("request headers exceeded maximum size".to_string());
        }
    };

    let header_bytes = &buffer[..header_end];
    let mut body = buffer[header_end + 4..].to_vec();
    let header_text = std::str::from_utf8(header_bytes).map_err(|err| err.to_string())?;
    let (method, target, headers) = parse_headers(header_text)?;
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > max_body_bytes {
        return Err("request body exceeded maximum size".to_string());
    }
    while body.len() < content_length {
        let read = stream.read(&mut temp).map_err(|err| err.to_string())?;
        if read == 0 {
            return Err("connection closed before body completed".to_string());
        }
        body.extend_from_slice(&temp[..read]);
        if body.len() > max_body_bytes {
            return Err("request body exceeded maximum size".to_string());
        }
    }
    body.truncate(content_length);
    let (path, query) = split_target(&target);
    Ok(HttpRequest {
        method,
        path,
        query,
        headers,
        body: String::from_utf8(body).map_err(|err| err.to_string())?,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_headers(header_text: &str) -> Result<(String, String, HashMap<String, String>), String> {
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "missing method".to_string())?
        .to_uppercase();
    let target = request_parts
        .next()
        .ok_or_else(|| "missing target".to_string())?
        .to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_lowercase(), value.trim().to_string());
        }
    }
    Ok((method, target, headers))
}

fn split_target(target: &str) -> (String, Option<String>) {
    match target.split_once('?') {
        Some((path, query)) => (path.to_string(), Some(query.to_string())),
        None => (target.to_string(), None),
    }
}

fn is_authorized(request: &HttpRequest, expected_token: &str) -> bool {
    token_from_authorization(request)
        .or_else(|| token_from_query(request))
        .is_some_and(|token| token == expected_token)
}

fn token_from_authorization(request: &HttpRequest) -> Option<String> {
    let value = request.headers.get("authorization")?;
    value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))
        .map(|token| token.trim().to_string())
}

fn token_from_query(request: &HttpRequest) -> Option<String> {
    request.query.as_ref()?.split('&').find_map(|part| {
        let (name, value) = part.split_once('=')?;
        (name == "token").then(|| value.to_string())
    })
}

fn http_response(status: u16, reason: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    )
}

fn json_message(ok: bool, message: &str) -> String {
    format!(
        r#"{{"ok":{},"message":"{}"}}"#,
        if ok { "true" } else { "false" },
        message.replace('"', "\\\"")
    )
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    query: Option<String>,
    headers: HashMap<String, String>,
    body: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(auth: Option<&str>, query: Option<&str>) -> HttpRequest {
        let mut headers = HashMap::new();
        if let Some(auth) = auth {
            headers.insert("authorization".to_string(), auth.to_string());
        }
        HttpRequest {
            method: "POST".to_string(),
            path: "/v1/audience/request".to_string(),
            query: query.map(str::to_string),
            headers,
            body: "{}".to_string(),
        }
    }

    #[test]
    fn authorizes_bearer_header() {
        assert!(is_authorized(
            &request(Some("Bearer secret"), None),
            "secret"
        ));
        assert!(!is_authorized(
            &request(Some("Bearer nope"), None),
            "secret"
        ));
    }

    #[test]
    fn authorizes_social_stream_ninja_query_token() {
        assert!(is_authorized(
            &request(None, Some("token=secret")),
            "secret"
        ));
        assert!(!is_authorized(&request(None, Some("token=nope")), "secret"));
    }

    #[test]
    fn splits_target_path_and_query() {
        assert_eq!(
            split_target("/v1/audience/request?token=abc"),
            (
                "/v1/audience/request".to_string(),
                Some("token=abc".to_string())
            )
        );
    }
}
