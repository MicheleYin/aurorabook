use tauri::Manager;
use std::path::Path;

#[tauri::command]
pub async fn read_resource_file(
    resource_path: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    use std::fs;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let mut possible_paths = vec![
        resource_dir.join(&resource_path),
        resource_dir.join("resources").join(&resource_path),
    ];

    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_path));
        possible_paths.push(current_dir.join("resources").join(&resource_path));
    }

    for path in &possible_paths {
        if path.exists() && path.is_file() {
            return fs::read(path)
                .map_err(|e| format!("Failed to read resource file {:?}: {}", path, e));
        }
    }

    Err(format!(
        "Resource file {} not found in any expected location. Checked: {:?}",
        resource_path, possible_paths
    ))
}

#[tauri::command]
pub async fn copy_resource_file(
    resource_path: String,
    target_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let mut possible_paths = vec![
        resource_dir.join(&resource_path),
        resource_dir.join("resources").join(&resource_path),
    ];

    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_path));
    }

    let mut data = None;
    let mut checked_paths = Vec::new();
    for path in &possible_paths {
        checked_paths.push(path.clone());
        if path.exists() {
            data = Some(fs::read(path)
                .map_err(|e| format!("Failed to read resource file {:?}: {}", path, e))?);
            break;
        }
    }

    let file_data = data.ok_or_else(|| {
        format!(
            "Resource file {} not found in any expected location. Checked: {:?}",
            resource_path, checked_paths
        )
    })?;

    if let Some(parent) = Path::new(&target_path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let mut file = fs::File::create(&target_path)
        .map_err(|e| format!("Failed to create target file: {}", e))?;
    file.write_all(&file_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn copy_directory(
    source_path: String,
    target_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::fs;

    fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
        fs::create_dir_all(dst)
            .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;

        for entry in fs::read_dir(src)
            .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))? {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            let file_name = entry.file_name();
            let target = dst.join(&file_name);

            if path.is_dir() {
                copy_dir_all(&path, &target)?;
            } else {
                fs::copy(&path, &target)
                    .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", path, target, e))?;
            }
        }
        Ok(())
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let mut possible_paths = Vec::new();

    let resource_name = if source_path.starts_with("resources/") {
        source_path.strip_prefix("resources/").unwrap_or(&source_path).to_string()
    } else {
        source_path.clone()
    };

    possible_paths.push(resource_dir.join(&resource_name));
    possible_paths.push(resource_dir.join("resources").join(&resource_name));

    if let Ok(current_dir) = std::env::current_dir() {
        possible_paths.push(current_dir.join("src-tauri").join("resources").join(&resource_name));
        possible_paths.push(current_dir.join("src-tauri").join(&resource_name));
    }

    possible_paths.push(Path::new(&source_path).to_path_buf());

    let mut found_path = None;
    for path in &possible_paths {
        if path.exists() {
            found_path = Some(path.clone());
            break;
        }
    }

    let source = found_path.ok_or_else(|| {
        format!(
            "Source path does not exist: {}. Checked locations: {:?}",
            source_path, possible_paths
        )
    })?;

    let target = Path::new(&target_path);

    if !source.exists() {
        return Err(format!("Source path does not exist: {}", source.display()));
    }

    if source.is_dir() {
        copy_dir_all(&source, target)
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directory: {}", e))?;
        }
        fs::copy(&source, target)
            .map_err(|e| format!("Failed to copy file: {}", e))?;
        Ok(())
    }
}
