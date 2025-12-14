use crate::services::book_service::invoke_tauri_command;
use wasm_bindgen::JsValue;
use serde_json::Value;

/// Read a resource file from Tauri resources directory
/// Returns the file data as a Vec<u8> (array of bytes)
pub async fn read_resource_file(resource_path: &str) -> Result<Vec<u8>, String> {
    let args: JsValue = serde_wasm_bindgen::to_value(&serde_json::json!({
        "resourcePath": resource_path
    })).map_err(|e| format!("Serialization failed: {}", e))?;
    
    let result = invoke_tauri_command::<serde_json::Value>("read_resource_file", args).await?;
    
    // Convert JSON array of numbers to Vec<u8>
    let numbers: Vec<u8> = serde_json::from_value(result)
        .map_err(|e| format!("Failed to deserialize file data: {}", e))?;
    
    Ok(numbers)
}
