#[cfg(any(test, target_os = "android", target_os = "ios", target_os = "macos"))]
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::{OsStr, OsString},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Emitter;
#[cfg(any(test, target_os = "android", target_os = "ios", target_os = "macos"))]
use tauri::Url;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
#[cfg(target_os = "windows")]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

pub mod native_cad_protocol;

#[cfg(target_os = "windows")]
const EMBEDDED_CAD_WORKER: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/kea3d-cad-worker.exe"));

const SUPPORTED_MODEL_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "stl", "3mf", "obj", "ply", "fbx", "dae", "step", "stp", "iges", "igs", "brep",
    "blend", "kea3d",
];
const PICKER_RESOURCE_EXTENSIONS: &[&str] =
    &["mtl", "bin", "png", "jpg", "jpeg", "webp", "avif", "ktx2"];
const NATIVE_OPEN_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const THUMBNAIL_PROVIDER_CLSID: &str = "{E50D62FC-E508-4A2D-82AF-A3290688D78C}";
const LEGACY_THUMBNAIL_PROVIDER_CLSIDS: &[&str] = &[
    "{7142101B-D67D-4B30-BBD6-4BB965CCA2AF}",
    "{27BE9363-C920-44A7-A384-6584C285935E}",
    "{EA069E0B-95E6-497C-B93E-0BE9FD79E72B}",
    "{362207C7-7FF2-446F-A440-DCE28AE6C07C}",
    "{D3D97E74-C682-400B-AC6E-76A999260635}",
    "{188B28DA-D746-4B26-8A3D-01BAC6D4C3B9}",
    "{9801B749-EE62-4094-B213-AD64411ECD74}",
    "{A8D177C0-27C4-42D9-B134-F849D6CD9820}",
];
const THUMBNAIL_PROVIDER_FILENAME: &str = "Kea3DThumbnailProvider.dll";
const THUMBNAIL_HANDLER_IID: &str = "{E357FCCD-A995-4576-B01F-234630154E96}";
const THUMBNAIL_EXTENSIONS: &[&str] = &["glb", "stl", "ply", "step", "stp"];

#[derive(Clone)]
struct PendingOpenFile {
    id: u64,
    name: String,
    source: FilePath,
    size: u64,
    relative_path: Option<String>,
}

struct ReadableOpenFile {
    source: FilePath,
    size: u64,
    file: Option<std::fs::File>,
    position: u64,
}

#[derive(Default)]
struct NativeOpenState {
    next_id: AtomicU64,
    pending: Mutex<VecDeque<PendingOpenFile>>,
    readable: Mutex<HashMap<u64, ReadableOpenFile>>,
}

#[derive(Default)]
struct NativeCadState {
    sessions: Arc<Mutex<HashMap<String, Arc<NativeCadSession>>>>,
}

struct NativeCadSession {
    stdin: Mutex<Option<ChildStdin>>,
    cancelled: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingOpenFileMetadata {
    id: u64,
    name: String,
    size: u64,
    requires_streaming: bool,
    source_url: Option<String>,
    native_cad_available: bool,
    relative_path: Option<String>,
    source_path: Option<String>,
}

#[derive(Deserialize)]
struct ProjectResourceProbe {
    id: String,
    uri: String,
}

#[derive(Deserialize)]
struct ProjectInstanceProbe {
    resource: String,
}

#[derive(Deserialize)]
struct ProjectDocumentProbe {
    format: String,
    version: u64,
    resources: Vec<ProjectResourceProbe>,
    instances: Vec<ProjectInstanceProbe>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailProviderStatus {
    available: bool,
    enabled: bool,
    format: &'static str,
}

fn thumbnail_provider_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|directory| directory.join(THUMBNAIL_PROVIDER_FILENAME))
}

#[cfg(target_os = "windows")]
fn registered_thumbnail_provider(extension: &str) -> Option<String> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!(
            r"Software\Classes\.{extension}\ShellEx\{THUMBNAIL_HANDLER_IID}"
        ))
        .ok()?;
    key.get_value("").ok()
}

#[cfg(target_os = "windows")]
fn registered_thumbnail_provider_path() -> Option<PathBuf> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!(
            r"Software\Classes\CLSID\{THUMBNAIL_PROVIDER_CLSID}\InprocServer32"
        ))
        .ok()?;
    key.get_value::<String, _>("").ok().map(PathBuf::from)
}

fn is_kea_thumbnail_provider(value: &str) -> bool {
    value.eq_ignore_ascii_case(THUMBNAIL_PROVIDER_CLSID)
        || LEGACY_THUMBNAIL_PROVIDER_CLSIDS
            .iter()
            .any(|legacy| value.eq_ignore_ascii_case(legacy))
}

#[cfg(target_os = "windows")]
fn notify_shell_association_changed() {
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
}

#[tauri::command]
fn get_thumbnail_provider_status() -> ThumbnailProviderStatus {
    let available = thumbnail_provider_path().is_some_and(|path| path.is_file());
    #[cfg(target_os = "windows")]
    let enabled = THUMBNAIL_EXTENSIONS.iter().all(|extension| {
        registered_thumbnail_provider(extension)
            .is_some_and(|value| value.eq_ignore_ascii_case(THUMBNAIL_PROVIDER_CLSID))
    }) && thumbnail_provider_path().is_some_and(|current| {
        registered_thumbnail_provider_path().is_some_and(|registered| registered == current)
    });
    #[cfg(not(target_os = "windows"))]
    let enabled = false;
    ThumbnailProviderStatus {
        available,
        enabled,
        format: "GLB · STL · PLY · STEP · STP",
    }
}

#[tauri::command]
fn set_thumbnail_provider_enabled(enabled: bool) -> Result<ThumbnailProviderStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let classes = RegKey::predef(HKEY_CURRENT_USER);
        let clsid_path = format!(r"Software\Classes\CLSID\{THUMBNAIL_PROVIDER_CLSID}");
        if enabled {
            let provider = thumbnail_provider_path()
                .filter(|path| path.is_file())
                .ok_or_else(|| {
                    format!("Keep {THUMBNAIL_PROVIDER_FILENAME} beside the portable executable.")
                })?;
            let (class, _) = classes
                .create_subkey(&clsid_path)
                .map_err(|error| format!("Could not register the thumbnail provider: {error}"))?;
            // Portable per-user COM registrations are unavailable to the isolated
            // thumbnail surrogate. Keep this bounded stream-based handler in-process.
            class
                .set_value("DisableProcessIsolation", &1_u32)
                .map_err(|error| format!("Could not configure Explorer integration: {error}"))?;
            let (server, _) = class
                .create_subkey("InprocServer32")
                .map_err(|error| format!("Could not register the thumbnail provider: {error}"))?;
            server
                .set_value("", &provider.to_string_lossy().to_string())
                .and_then(|_| server.set_value("ThreadingModel", &"Apartment"))
                .map_err(|error| format!("Could not configure the thumbnail provider: {error}"))?;
            for extension in THUMBNAIL_EXTENSIONS {
                let association_path =
                    format!(r"Software\Classes\.{extension}\ShellEx\{THUMBNAIL_HANDLER_IID}");
                let (association, _) =
                    classes.create_subkey(&association_path).map_err(|error| {
                        format!("Could not register {extension} thumbnails: {error}")
                    })?;
                association
                    .set_value("", &THUMBNAIL_PROVIDER_CLSID)
                    .map_err(|error| {
                        format!("Could not register {extension} thumbnails: {error}")
                    })?;
            }
            for legacy in LEGACY_THUMBNAIL_PROVIDER_CLSIDS {
                let _ = classes.delete_subkey_all(format!(r"Software\Classes\CLSID\{legacy}"));
            }
        } else {
            for extension in THUMBNAIL_EXTENSIONS {
                if registered_thumbnail_provider(extension)
                    .is_some_and(|value| is_kea_thumbnail_provider(&value))
                {
                    let association_path =
                        format!(r"Software\Classes\.{extension}\ShellEx\{THUMBNAIL_HANDLER_IID}");
                    let _ = classes.delete_subkey_all(&association_path);
                }
            }
            let _ = classes.delete_subkey_all(&clsid_path);
            for legacy in LEGACY_THUMBNAIL_PROVIDER_CLSIDS {
                let _ = classes.delete_subkey_all(format!(r"Software\Classes\CLSID\{legacy}"));
            }
        }
        notify_shell_association_changed();
        Ok(get_thumbnail_provider_status())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Explorer thumbnail integration is available in the Windows portable build.".to_owned())
    }
}

fn has_supported_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .is_some_and(|extension| SUPPORTED_MODEL_EXTENSIONS.contains(&extension.as_str()))
}

fn supported_model_path(argument: &OsStr, current_dir: &Path) -> Option<PathBuf> {
    let candidate = PathBuf::from(argument);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        current_dir.join(candidate)
    };
    if !has_supported_extension(candidate.to_string_lossy().as_ref()) || !candidate.is_file() {
        return None;
    }
    candidate.canonicalize().ok()
}

fn selected_model_path(argument: &OsStr, current_dir: &Path) -> Option<PathBuf> {
    let candidate = PathBuf::from(argument);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        current_dir.join(candidate)
    };
    let extension = candidate
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)?;
    if (!SUPPORTED_MODEL_EXTENSIONS.contains(&extension.as_str())
        && !PICKER_RESOURCE_EXTENSIONS.contains(&extension.as_str()))
        || !candidate.is_file()
    {
        return None;
    }
    candidate.canonicalize().ok()
}

fn project_resource_uri_is_safe(uri: &str) -> bool {
    if uri.is_empty()
        || uri.len() > 1024
        || uri.contains('\\')
        || uri.contains('?')
        || uri.contains('#')
        || uri.contains('%')
        || uri.starts_with('/')
        || uri.starts_with("//")
        || uri.get(1..2) == Some(":")
        || !uri.to_ascii_lowercase().ends_with(".glb")
    {
        return false;
    }
    uri.split('/').all(|segment| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment.chars().all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(
                        character,
                        ' ' | '_' | '.' | ',' | '+' | '@' | '(' | ')' | '\'' | '&' | '-'
                    )
            })
    })
}

fn pending_path_file(
    state: &NativeOpenState,
    path: PathBuf,
    relative_path: Option<String>,
) -> Option<PendingOpenFile> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let size = path.metadata().ok()?.len();
    Some(PendingOpenFile {
        id: state.next_id.fetch_add(1, Ordering::Relaxed) + 1,
        name,
        source: FilePath::Path(path),
        size,
        relative_path,
    })
}

fn project_open_files(state: &NativeOpenState, manifest_path: PathBuf) -> Vec<PendingOpenFile> {
    let mut files = Vec::new();
    let manifest_name = manifest_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    if let Some(manifest) = pending_path_file(state, manifest_path.clone(), manifest_name) {
        files.push(manifest);
    }

    let Ok(metadata) = manifest_path.metadata() else {
        return files;
    };
    if metadata.len() > 2 * 1024 * 1024 {
        return files;
    }
    let Ok(json) = std::fs::read(&manifest_path) else {
        return files;
    };
    let Ok(project) = serde_json::from_slice::<ProjectDocumentProbe>(&json) else {
        return files;
    };
    if project.format != "kea3d-project"
        || project.version != 1
        || project.resources.len() > 1024
        || project.instances.len() > 10_000
    {
        return files;
    }
    let referenced = project
        .instances
        .into_iter()
        .map(|instance| instance.resource)
        .collect::<HashSet<_>>();
    let Some(project_directory) = manifest_path.parent() else {
        return files;
    };
    let Ok(project_root) = project_directory.canonicalize() else {
        return files;
    };
    for resource in project.resources {
        if !referenced.contains(&resource.id) {
            continue;
        }
        if !project_resource_uri_is_safe(&resource.uri) {
            continue;
        }
        let Ok(path) = project_directory.join(&resource.uri).canonicalize() else {
            continue;
        };
        if !path.starts_with(&project_root) || !path.is_file() {
            continue;
        }
        if let Some(file) = pending_path_file(state, path, Some(resource.uri)) {
            files.push(file);
        }
    }
    files
}

fn selected_open_files(state: &NativeOpenState, path: PathBuf) -> Vec<PendingOpenFile> {
    if path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("kea3d"))
    {
        project_open_files(state, path)
    } else {
        pending_path_file(state, path, None).into_iter().collect()
    }
}

fn deduplicate_pending_paths(files: Vec<PendingOpenFile>) -> Vec<PendingOpenFile> {
    let mut seen = HashSet::new();
    files
        .into_iter()
        .filter(|file| match &file.source {
            FilePath::Path(path) => seen.insert(path.clone()),
            FilePath::Url(_) => true,
        })
        .collect()
}

fn enqueue_open_files(
    state: &NativeOpenState,
    arguments: impl IntoIterator<Item = OsString>,
    current_dir: &Path,
) -> usize {
    let files = arguments
        .into_iter()
        .filter_map(|argument| supported_model_path(&argument, current_dir))
        .flat_map(|path| selected_open_files(state, path))
        .collect::<Vec<_>>();
    let files = deduplicate_pending_paths(files);
    let count = files.len();
    if count > 0 {
        state.pending.lock().unwrap().extend(files);
    }
    count
}

#[tauri::command]
fn queue_open_file_paths(
    paths: Vec<String>,
    app: AppHandle,
    state: tauri::State<'_, NativeOpenState>,
) -> usize {
    let current_dir = std::env::current_dir().unwrap_or_default();
    let files = paths
        .into_iter()
        .filter_map(|path| selected_model_path(OsStr::new(&path), &current_dir))
        .flat_map(|path| selected_open_files(&state, path))
        .collect::<Vec<_>>();
    let files = deduplicate_pending_paths(files);
    let queued = files.len();
    if queued > 0 {
        state.pending.lock().unwrap().extend(files);
    }
    if queued > 0 {
        let _ = app.emit("native-open-files", ());
    }
    queued
}

fn is_native_step_source(source: &FilePath, name: &str) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase);
    matches!(source, FilePath::Path(_))
        && matches!(extension.as_deref(), Some("step") | Some("stp"))
        && native_cad_worker_is_embedded()
}

#[cfg(target_os = "windows")]
fn native_cad_worker_is_embedded() -> bool {
    !EMBEDDED_CAD_WORKER.is_empty()
}

#[cfg(not(target_os = "windows"))]
fn native_cad_worker_is_embedded() -> bool {
    false
}

#[cfg(any(test, target_os = "android", target_os = "ios", target_os = "macos"))]
fn model_name_from_url(url: &Url) -> Option<String> {
    let encoded = url.path_segments()?.next_back()?;
    let decoded = percent_decode_str(encoded).decode_utf8_lossy();
    Path::new(decoded.as_ref())
        .file_name()
        .and_then(OsStr::to_str)
        .map(str::to_owned)
        .filter(|name| !name.is_empty())
}

#[cfg(any(test, target_os = "android", target_os = "ios", target_os = "macos"))]
fn infer_model_extension(header: &[u8], size: u64) -> Option<&'static str> {
    if header.starts_with(b"glTF") {
        return Some("glb");
    }
    if header.starts_with(b"Kaydara FBX Binary") {
        return Some("fbx");
    }
    if header.starts_with(b"BLENDER") {
        return Some("blend");
    }
    if header.starts_with(b"ply") {
        return Some("ply");
    }
    if header.starts_with(b"PK\x03\x04") {
        return Some("3mf");
    }

    let lowercase = String::from_utf8_lossy(header).to_ascii_lowercase();
    if lowercase.contains("iso-10303-21") {
        return Some("step");
    }
    if lowercase.contains("<collada") {
        return Some("dae");
    }
    if lowercase.contains("dbrep_drawableshape") {
        return Some("brep");
    }
    if lowercase.trim_start().starts_with('{')
        && lowercase.contains("\"asset\"")
        && lowercase.contains("\"version\"")
    {
        return Some("gltf");
    }
    if lowercase.trim_start().starts_with("solid") && lowercase.contains("facet") {
        return Some("stl");
    }
    if lowercase.lines().any(|line| line.starts_with("v "))
        && lowercase.lines().any(|line| line.starts_with("f "))
    {
        return Some("obj");
    }
    if header.get(72) == Some(&b'S')
        && header.get(73..80).is_some_and(|field| {
            field
                .iter()
                .all(|byte| byte.is_ascii_digit() || byte.is_ascii_whitespace())
        })
    {
        return Some("iges");
    }
    if header.len() >= 84 {
        let triangle_count = u32::from_le_bytes(header[80..84].try_into().ok()?) as u64;
        if 84_u64.saturating_add(triangle_count.saturating_mul(50)) == size {
            return Some("stl");
        }
    }
    None
}

#[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
fn inspect_model_url(app: &AppHandle, url: &Url) -> Option<(&'static str, u64)> {
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = app.fs().open(FilePath::Url(url.clone()), options).ok()?;
    let size = file.metadata().ok().map_or(0, |metadata| metadata.len());
    let mut header = vec![0_u8; 4096];
    let read = file.read(&mut header).ok()?;
    header.truncate(read);
    infer_model_extension(&header, size).map(|extension| (extension, size))
}

#[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
fn enqueue_open_urls(
    app: &AppHandle,
    state: &NativeOpenState,
    urls: impl IntoIterator<Item = Url>,
) -> usize {
    let current_dir = std::env::current_dir().unwrap_or_default();
    let mut files = Vec::new();

    for url in urls {
        if let Ok(path) = url.to_file_path() {
            if let Some(path) = supported_model_path(path.as_os_str(), &current_dir) {
                files.extend(selected_open_files(state, path));
            }
            continue;
        }

        if url.scheme() != "content" {
            continue;
        }

        let url_name = model_name_from_url(&url);
        let inspected = inspect_model_url(app, &url);
        let (name, size) = if let Some(name) = url_name.filter(|name| has_supported_extension(name))
        {
            (name, inspected.map_or(0, |(_, size)| size))
        } else if let Some((extension, size)) = inspected {
            (format!("model.{extension}"), size)
        } else {
            continue;
        };

        files.push(PendingOpenFile {
            id: state.next_id.fetch_add(1, Ordering::Relaxed) + 1,
            name,
            source: FilePath::Url(url),
            size,
            relative_path: None,
        });
    }

    let files = deduplicate_pending_paths(files);
    let count = files.len();
    if count > 0 {
        state.pending.lock().unwrap().extend(files);
    }
    count
}

#[tauri::command]
fn take_pending_open_files(
    state: tauri::State<'_, NativeOpenState>,
) -> Vec<PendingOpenFileMetadata> {
    let files = state.pending.lock().unwrap().drain(..).collect::<Vec<_>>();
    let mut readable = state.readable.lock().unwrap();
    files
        .into_iter()
        .map(|file| {
            let requires_streaming = matches!(&file.source, FilePath::Url(_));
            let native_cad_available = is_native_step_source(&file.source, &file.name);
            let source_url = match &file.source {
                FilePath::Url(url) => Some(url.to_string()),
                FilePath::Path(_) => None,
            };
            let source_path = match &file.source {
                FilePath::Path(path) => Some(path.to_string_lossy().into_owned()),
                FilePath::Url(_) => None,
            };
            readable.insert(
                file.id,
                ReadableOpenFile {
                    source: file.source,
                    size: file.size,
                    file: None,
                    position: 0,
                },
            );
            PendingOpenFileMetadata {
                id: file.id,
                name: file.name,
                size: file.size,
                requires_streaming,
                source_url,
                native_cad_available,
                relative_path: file.relative_path,
                source_path,
            }
        })
        .collect()
}

fn validate_project_save(destination: &Path, contents: &[u8]) -> Result<(), String> {
    if !destination
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("kea3d"))
    {
        return Err("Kea3D projects must use the .kea3d extension.".to_owned());
    }
    if contents.is_empty() || contents.len() > 2 * 1024 * 1024 {
        return Err("The Kea3D project document has an invalid size.".to_owned());
    }
    let project: ProjectDocumentProbe = serde_json::from_slice(contents)
        .map_err(|error| format!("The Kea3D project document is invalid: {error}"))?;
    if project.format != "kea3d-project"
        || project.version != 1
        || project.resources.is_empty()
        || project.resources.len() > 1024
        || project.instances.is_empty()
        || project.instances.len() > 10_000
    {
        return Err("The Kea3D project document is invalid.".to_owned());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn replace_project_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let replaced = destination.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let replacement = temporary.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let result = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(target_os = "windows"))]
fn replace_project_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(temporary, destination)
}

fn write_project_file_atomic(destination: &Path, contents: &[u8]) -> Result<(), String> {
    validate_project_save(destination, contents)?;
    let parent = destination
        .parent()
        .filter(|parent| parent.is_dir())
        .ok_or_else(|| "The project destination folder does not exist.".to_owned())?;
    let stem = destination.file_name().and_then(OsStr::to_str).unwrap_or("project.kea3d");
    let mut temporary = None;
    for attempt in 0..100_u32 {
        let candidate = parent.join(format!(".{stem}.{}.{}.tmp", std::process::id(), attempt));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(mut file) => {
                let write_result = file.write_all(contents).and_then(|_| file.sync_all());
                if let Err(error) = write_result {
                    let _ = std::fs::remove_file(&candidate);
                    return Err(format!("Could not write the project safely: {error}"));
                }
                temporary = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not prepare the project save: {error}")),
        }
    }
    let temporary = temporary.ok_or_else(|| "Could not reserve a temporary project file.".to_owned())?;
    let result = if destination.exists() {
        replace_project_file(&temporary, destination)
    } else {
        std::fs::rename(&temporary, destination)
    };
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Could not replace the project file: {error}"));
    }
    Ok(())
}

#[tauri::command(async)]
async fn save_project_file_atomic(path: String, contents: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_project_file_atomic(Path::new(&path), &contents))
        .await
        .map_err(|error| format!("The project save task could not finish: {error}"))?
}

#[cfg(target_os = "windows")]
fn native_cad_worker_path() -> Result<PathBuf, String> {
    use std::fs;

    if EMBEDDED_CAD_WORKER.is_empty() {
        return Err("This build does not include the native large-STEP engine.".to_owned());
    }
    let directory = std::env::temp_dir()
        .join("Kea3D")
        .join(env!("CARGO_PKG_VERSION"));
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not prepare the native CAD engine: {error}"))?;
    let worker = directory.join(format!(
        "kea3d-cad-worker-{}.exe",
        EMBEDDED_CAD_WORKER.len()
    ));
    let current_length = fs::metadata(&worker).ok().map(|metadata| metadata.len());
    if current_length != Some(EMBEDDED_CAD_WORKER.len() as u64) {
        let temporary = directory.join(format!(
            "kea3d-cad-worker-{}-{}.tmp",
            std::process::id(),
            EMBEDDED_CAD_WORKER.len()
        ));
        fs::write(&temporary, EMBEDDED_CAD_WORKER)
            .map_err(|error| format!("Could not extract the native CAD engine: {error}"))?;
        if worker.exists() {
            fs::remove_file(&worker)
                .map_err(|error| format!("Could not update the native CAD engine: {error}"))?;
        }
        fs::rename(&temporary, &worker)
            .map_err(|error| format!("Could not activate the native CAD engine: {error}"))?;
    }
    Ok(worker)
}

#[cfg(target_os = "windows")]
fn encode_native_cad_frame(frame: &native_cad_protocol::Frame) -> Result<Vec<u8>, String> {
    let header = serde_json::to_vec(&frame.header)
        .map_err(|error| format!("Could not encode a native CAD event: {error}"))?;
    let header_length = u32::try_from(header.len())
        .map_err(|_| "The native CAD event header is too large.".to_owned())?;
    let mut bytes = Vec::with_capacity(4 + header.len() + frame.payload.len());
    bytes.extend_from_slice(&header_length.to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(&frame.payload);
    Ok(bytes)
}

#[cfg(target_os = "windows")]
fn run_native_cad_import(
    source: PathBuf,
    expected_size: u64,
    session_id: String,
    events: tauri::ipc::Channel<tauri::ipc::Response>,
    cad_state: NativeCadState,
) -> Result<(), String> {
    use native_cad_protocol::{
        read_frame, validate_mesh_payload, SessionTracker, TerminalStatus, WorkerEvent,
        PROTOCOL_VERSION,
    };
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let actual_size = source
        .metadata()
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?
        .len();
    if actual_size != expected_size {
        return Err("The STEP file changed while Kea3D was opening it. Try again.".to_owned());
    }

    let worker = native_cad_worker_path()?;
    let mut child = Command::new(worker)
        .args([
            OsStr::new("--protocol"),
            OsStr::new("1"),
            OsStr::new("--session"),
            OsStr::new(&session_id),
            OsStr::new("--input"),
            source.as_os_str(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("Could not start the native CAD engine: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The native CAD engine did not provide an output stream.".to_owned())?;
    let stderr = child.stderr.take();
    let session = Arc::new(NativeCadSession {
        stdin: Mutex::new(child.stdin.take()),
        cancelled: AtomicBool::new(false),
    });
    cad_state
        .sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), session.clone());

    let diagnostic = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(mut stderr) = stderr {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    });
    let mut reader = std::io::BufReader::new(stdout);
    let mut tracker = SessionTracker::new(&session_id);
    let mut terminal_message = None;
    let stream_result = (|| -> Result<(), String> {
        while let Some(frame) = read_frame(&mut reader).map_err(|error| error.to_string())? {
            tracker.accept(&frame).map_err(|error| error.to_string())?;
            match &frame.header.event {
                WorkerEvent::Manifest { .. } => {
                    serde_json::from_slice::<serde_json::Value>(&frame.payload)
                        .map_err(|error| format!("The native CAD manifest is invalid: {error}"))?;
                }
                WorkerEvent::MeshBatch { .. } => {
                    validate_mesh_payload(&frame).map_err(|error| error.to_string())?;
                }
                WorkerEvent::Terminal { status, message } => {
                    if *status == TerminalStatus::Failure {
                        terminal_message = message.clone();
                    }
                }
                WorkerEvent::Progress { .. } => {}
            }
            events
                .send(tauri::ipc::Response::new(encode_native_cad_frame(&frame)?))
                .map_err(|error| format!("Could not deliver native CAD geometry: {error}"))?;
        }
        Ok(())
    })();

    if stream_result.is_err() {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|error| format!("Could not finish the native CAD engine: {error}"));
    cad_state.sessions.lock().unwrap().remove(&session_id);
    let diagnostic = diagnostic.join().unwrap_or_default();
    stream_result?;
    let status = status?;
    let final_status =
        tracker.finalize_after_exit(session.cancelled.load(Ordering::Relaxed), status.success());
    match final_status {
        TerminalStatus::Success => Ok(()),
        TerminalStatus::Cancelled => Err("The model load was cancelled.".to_owned()),
        TerminalStatus::Failure => Err(terminal_message
            .filter(|message| !message.trim().is_empty())
            .or_else(|| (!diagnostic.trim().is_empty()).then(|| diagnostic.trim().to_owned()))
            .unwrap_or_else(|| {
                format!(
                    "The native CAD engine exited with code {} (protocol {PROTOCOL_VERSION}).",
                    status.code().unwrap_or(-1)
                )
            })),
    }
}

#[tauri::command(async)]
async fn import_pending_native_cad(
    id: u64,
    session_id: String,
    events: tauri::ipc::Channel<tauri::ipc::Response>,
    open_state: tauri::State<'_, NativeOpenState>,
    cad_state: tauri::State<'_, NativeCadState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if session_id.is_empty() || session_id.len() > 128 {
            return Err("The native CAD session identifier is invalid.".to_owned());
        }
        let readable = open_state
            .readable
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or_else(|| "The requested STEP model is no longer available to open.".to_owned())?;
        let FilePath::Path(source) = readable.source else {
            return Err("Native CAD import requires a local desktop file.".to_owned());
        };
        if !is_native_step_source(
            &FilePath::Path(source.clone()),
            source.to_string_lossy().as_ref(),
        ) {
            return Err("Native CAD import currently supports local STEP files only.".to_owned());
        }
        let state = NativeCadState {
            sessions: cad_state.sessions.clone(),
        };
        return tauri::async_runtime::spawn_blocking(move || {
            run_native_cad_import(source, readable.size, session_id, events, state)
        })
        .await
        .map_err(|error| format!("The native CAD task could not finish: {error}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (id, session_id, events, open_state, cad_state);
        Err("Native large-STEP import is currently available on Windows x64 only.".to_owned())
    }
}

#[tauri::command]
fn cancel_native_cad_import(
    session_id: String,
    state: tauri::State<'_, NativeCadState>,
) -> Result<(), String> {
    let session = state.sessions.lock().unwrap().get(&session_id).cloned();
    let Some(session) = session else {
        return Ok(());
    };
    session.cancelled.store(true, Ordering::Relaxed);
    let command = native_cad_protocol::HostCommand {
        protocol_version: native_cad_protocol::PROTOCOL_VERSION,
        session_id,
        command: native_cad_protocol::HostCommandKind::Cancel,
    };
    let mut stdin = session.stdin.lock().unwrap();
    if let Some(stdin) = stdin.as_mut() {
        let mut bytes = serde_json::to_vec(&command)
            .map_err(|error| format!("Could not encode CAD cancellation: {error}"))?;
        bytes.push(b'\n');
        stdin
            .write_all(&bytes)
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not cancel the native CAD engine: {error}"))?;
    }
    Ok(())
}

#[tauri::command(async)]
fn stream_pending_open_file(
    id: u64,
    expected_size: u64,
    reader: tauri::ipc::Channel<tauri::ipc::Response>,
    app: AppHandle,
    state: tauri::State<'_, NativeOpenState>,
) -> Result<(), String> {
    let readable = state
        .readable
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| "The requested model is no longer available to open.".to_owned())?;
    if readable.size != expected_size {
        return Err("The requested model size does not match the pending file.".to_owned());
    }
    let source = readable.source;
    if !matches!(&source, FilePath::Url(_)) {
        return Err("Only provider-backed files need native streaming.".to_owned());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    let display = source.to_string();
    let mut file = app
        .fs()
        .open(source, options)
        .map_err(|error| format!("Could not open {display}: {error}"))?;
    let mut total = 0_u64;
    loop {
        let mut bytes = vec![0_u8; NATIVE_OPEN_CHUNK_BYTES];
        let length = file
            .read(&mut bytes)
            .map_err(|error| format!("Could not read {display}: {error}"))?;
        if length == 0 {
            break;
        }
        bytes.truncate(length);
        total = total.saturating_add(length as u64);
        if expected_size > 0 && total > expected_size {
            return Err("The file provider returned more data than expected.".to_owned());
        }
        reader
            .send(tauri::ipc::Response::new(bytes))
            .map_err(|error| format!("Could not stream the model to the viewer: {error}"))?;
    }
    if expected_size > 0 && total != expected_size {
        return Err(format!(
            "The file provider supplied {total} bytes instead of the expected {expected_size} bytes."
        ));
    }
    reader
        .send(tauri::ipc::Response::new(Vec::<u8>::new()))
        .map_err(|error| format!("Could not finish the model stream: {error}"))?;
    Ok(())
}

#[tauri::command]
fn read_pending_open_file(
    id: u64,
    app: AppHandle,
    state: tauri::State<'_, NativeOpenState>,
) -> Result<tauri::ipc::Response, String> {
    let readable = state
        .readable
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or_else(|| "The requested model is no longer available to open.".to_owned())?;
    let source = readable.source;
    let display = source.to_string();
    let mut options = OpenOptions::new();
    options.read(true);
    let mut file = app
        .fs()
        .open(source, options)
        .map_err(|error| format!("Could not open {display}: {error}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {display}: {error}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
fn read_path_chunk(path: &Path, offset: u64, expected_size: u64) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    read_file_chunk(
        &mut file,
        &path.display().to_string(),
        offset,
        expected_size,
        true,
    )
}

fn read_file_chunk(
    file: &mut std::fs::File,
    display: &str,
    offset: u64,
    expected_size: u64,
    seek: bool,
) -> Result<Vec<u8>, String> {
    let actual_size = file
        .metadata()
        .map_err(|error| format!("Could not inspect {display}: {error}"))?
        .len();
    if actual_size > 0 && actual_size != expected_size {
        return Err("The model changed while Kea3D was opening it. Try again.".to_owned());
    }
    if offset > expected_size {
        return Err("The requested model range is outside the file.".to_owned());
    }

    let length = (expected_size - offset).min(NATIVE_OPEN_CHUNK_BYTES as u64) as usize;
    let mut bytes = vec![0_u8; length];
    if seek {
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| format!("Could not seek {display}: {error}"))?;
    }
    file.read_exact(&mut bytes)
        .map_err(|error| format!("Could not read {display}: {error}"))?;
    Ok(bytes)
}

#[tauri::command]
fn read_pending_open_file_chunk(
    id: u64,
    offset: u64,
    expected_size: u64,
    app: AppHandle,
    state: tauri::State<'_, NativeOpenState>,
) -> Result<tauri::ipc::Response, String> {
    let mut readable = state.readable.lock().unwrap();
    let readable = readable
        .get_mut(&id)
        .ok_or_else(|| "The requested model is no longer available to open.".to_owned())?;
    if readable.size != expected_size {
        return Err("The requested model size does not match the pending file.".to_owned());
    }
    if readable.file.is_none() {
        let mut options = OpenOptions::new();
        options.read(true);
        readable.file = Some(
            app.fs()
                .open(readable.source.clone(), options)
                .map_err(|error| format!("Could not open {}: {error}", readable.source))?,
        );
    }
    let display = readable.source.to_string();
    let bytes = read_file_chunk(
        readable.file.as_mut().unwrap(),
        &display,
        offset,
        expected_size,
        readable.position != offset,
    )?;
    readable.position = offset + bytes.len() as u64;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn finish_pending_open_file(id: u64, state: tauri::State<'_, NativeOpenState>) {
    state.readable.lock().unwrap().remove(&id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    let app = builder
        .manage(NativeOpenState::default())
        .manage(NativeCadState::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_open_files,
            queue_open_file_paths,
            import_pending_native_cad,
            cancel_native_cad_import,
            stream_pending_open_file,
            read_pending_open_file,
            read_pending_open_file_chunk,
            finish_pending_open_file,
            save_project_file_atomic,
            get_thumbnail_provider_status,
            set_thumbnail_provider_enabled
        ])
        .setup(|app| {
            let current_dir = std::env::current_dir().unwrap_or_default();
            enqueue_open_files(
                &app.state::<NativeOpenState>(),
                std::env::args_os().skip(1),
                &current_dir,
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        let _ = (&app, &event);
        #[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let queued = enqueue_open_urls(app, &app.state::<NativeOpenState>(), urls);
            if queued > 0 {
                let _ = app.emit("native-open-files", ());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_project_documents_with_atomic_create_and_replace() {
        let root = std::env::temp_dir().join(format!("kea3d-project-save-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let destination = root.join("assembly.kea3d");
        let first = br#"{"format":"kea3d-project","version":1,"resources":[{"id":"part","uri":"part.glb"}],"instances":[{"resource":"part"}]}"#;
        let second = br#"{"format":"kea3d-project","version":1,"resources":[{"id":"part","uri":"part.glb"}],"instances":[{"resource":"part"}],"name":"updated"}"#;
        write_project_file_atomic(&destination, first).unwrap();
        write_project_file_atomic(&destination, second).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), second);
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        assert!(write_project_file_atomic(&root.join("project.json"), first).is_err());
        assert!(write_project_file_atomic(&destination, b"not json").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn queues_only_existing_supported_model_files() {
        let root = std::env::temp_dir().join(format!("kea3d-native-open-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("model.GLB"), b"glb").unwrap();
        std::fs::write(root.join("assembly.kea3d"), b"{}").unwrap();
        std::fs::write(root.join("notes.txt"), b"text").unwrap();

        let state = NativeOpenState::default();
        let count = enqueue_open_files(
            &state,
            [
                OsString::from("model.GLB"),
                OsString::from("assembly.kea3d"),
                OsString::from("notes.txt"),
            ],
            &root,
        );

        assert_eq!(count, 2);
        let pending = state.pending.lock().unwrap();
        assert_eq!(pending.front().unwrap().name, "model.GLB");
        assert_eq!(pending.front().unwrap().size, 3);
        assert_eq!(pending.get(1).unwrap().name, "assembly.kea3d");

        drop(pending);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expands_safe_project_resources_with_relative_paths() {
        let root =
            std::env::temp_dir().join(format!("kea3d-native-project-{}", std::process::id()));
        let components = root.join("components");
        std::fs::create_dir_all(&components).unwrap();
        std::fs::write(components.join("base.glb"), b"glTF").unwrap();
        std::fs::write(root.join("outside.glb"), b"glTF").unwrap();
        std::fs::write(
            root.join("assembly.kea3d"),
            br#"{"format":"kea3d-project","version":1,"resources":[{"id":"base-model","uri":"components/base.glb"},{"id":"outside-model","uri":"../outside.glb"},{"id":"missing-model","uri":"components/missing.glb"}],"instances":[{"resource":"base-model"},{"resource":"outside-model"},{"resource":"missing-model"}]}"#,
        ).unwrap();

        let state = NativeOpenState::default();
        let count = enqueue_open_files(
            &state,
            [
                OsString::from("assembly.kea3d"),
                OsString::from("components/base.glb"),
            ],
            &root,
        );

        assert_eq!(count, 2);
        let pending = state.pending.lock().unwrap();
        assert_eq!(pending[0].name, "assembly.kea3d");
        assert_eq!(pending[0].relative_path.as_deref(), Some("assembly.kea3d"));
        assert_eq!(pending[1].name, "base.glb");
        assert_eq!(
            pending[1].relative_path.as_deref(),
            Some("components/base.glb")
        );
        drop(pending);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extracts_percent_encoded_android_document_name() {
        let url = Url::parse(
            "content://com.android.providers.downloads.documents/document/primary%3ADownload%2Fhelmet.glb",
        )
        .unwrap();

        assert_eq!(model_name_from_url(&url).as_deref(), Some("helmet.glb"));
    }

    #[test]
    fn identifies_common_model_headers() {
        assert_eq!(infer_model_extension(b"glTF\x02\0\0\0", 12), Some("glb"));
        assert_eq!(
            infer_model_extension(b"ISO-10303-21;\nHEADER;", 24),
            Some("step")
        );
        assert_eq!(infer_model_extension(b"BLENDER-v300", 12), Some("blend"));
    }

    #[test]
    fn reads_native_files_in_bounded_chunks_and_rejects_changes() {
        let path =
            std::env::temp_dir().join(format!("kea3d-native-open-chunk-{}", std::process::id()));
        let bytes = vec![7_u8; NATIVE_OPEN_CHUNK_BYTES + 3];
        std::fs::write(&path, &bytes).unwrap();

        let first = read_path_chunk(&path, 0, bytes.len() as u64).unwrap();
        let second =
            read_path_chunk(&path, NATIVE_OPEN_CHUNK_BYTES as u64, bytes.len() as u64).unwrap();
        assert_eq!(first.len(), NATIVE_OPEN_CHUNK_BYTES);
        assert_eq!(second, vec![7_u8; 3]);
        assert!(read_path_chunk(&path, 0, bytes.len() as u64 + 1).is_err());

        let mut sequential = std::fs::File::open(&path).unwrap();
        let first = read_file_chunk(&mut sequential, "test", 0, bytes.len() as u64, false).unwrap();
        let second = read_file_chunk(
            &mut sequential,
            "test",
            NATIVE_OPEN_CHUNK_BYTES as u64,
            bytes.len() as u64,
            false,
        )
        .unwrap();
        assert_eq!(first.len(), NATIVE_OPEN_CHUNK_BYTES);
        assert_eq!(second, vec![7_u8; 3]);

        std::fs::remove_file(path).unwrap();
    }
}
