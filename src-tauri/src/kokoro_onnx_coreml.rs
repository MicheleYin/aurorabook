// ONNX Runtime wrapper with CoreML Execution Provider support
// This module provides ONNX Runtime inference with CoreML EP for optimal performance on Apple devices

#[cfg(any(target_os = "macos", target_os = "ios"))]
use ort::{
    execution_providers::{coreml::CoreMLExecutionProvider, cpu::CPUExecutionProvider},
    session::{Session, SessionInputValue, SessionInputs, SessionOutputs, builder::SessionBuilder},
    logging::LogLevel,
    value::{Tensor, Value},
};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::collections::HashMap;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::sync::{Arc, Mutex};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::borrow::Cow;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use ndarray::ArrayD;

/// ONNX Runtime session with CoreML EP for Kokoro TTS models
#[cfg(any(target_os = "macos", target_os = "ios"))]
#[allow(dead_code)] // Used in tests and may be used by library consumers
pub struct KokoroOnnxCoreML {
    session: Arc<Mutex<Session>>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[allow(dead_code)] // Methods are used in tests and may be used by library consumers
impl KokoroOnnxCoreML {
    /// Create a new ONNX Runtime session with CoreML EP
    /// 
    /// # Arguments
    /// * `model_path` - Path to the ONNX model file
    /// * `use_coreml` - Whether to use CoreML EP (default: true on macOS/iOS)
    pub fn new(model_path: &str, use_coreml: bool) -> Result<Self, String> {
        let mut builder = SessionBuilder::new()
            .map_err(|e| format!("Failed to create session builder: {}", e))?;

        // Configure execution providers
        if use_coreml {
            // Configure CoreML EP with optimal settings
            let coreml_provider = CoreMLExecutionProvider::default()
                .with_model_format(ort::execution_providers::coreml::CoreMLModelFormat::MLProgram)
                .with_compute_units(ort::execution_providers::coreml::CoreMLComputeUnits::All)
                .with_static_input_shapes(false)
                .with_subgraphs(false)
                .with_profile_compute_plan(true); // Enable profiling to verify GPU/ANE usage

            // Use CoreML EP first, fallback to CPU
            builder = builder
                .with_execution_providers([coreml_provider.build(), CPUExecutionProvider::default().build()])
                .map_err(|e| format!("Failed to set CoreML execution provider: {}", e))?;
            
            println!("✅ Configured ONNX Runtime with CoreML EP (MLProgram format, ALL compute units)");
            println!("   Profiling enabled - check logs for hardware dispatch information");
        } else {
            // CPU only
            builder = builder
                .with_execution_providers([CPUExecutionProvider::default().build()])
                .map_err(|e| format!("Failed to set CPU execution provider: {}", e))?;
            
            println!("⚠️ Using CPU execution provider only (CoreML disabled)");
        }

        // Set log level
        builder = builder
            .with_log_level(LogLevel::Warning)
            .map_err(|e| format!("Failed to set log level: {}", e))?;

        // Load model
        let session = builder
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load ONNX model from {}: {}", model_path, e))?;

        println!("✅ Loaded ONNX model: {}", model_path);
        println!("   Inputs: {:?}", session.inputs.iter().map(|i| &i.name).collect::<Vec<_>>());
        println!("   Outputs: {:?}", session.outputs.iter().map(|o| &o.name).collect::<Vec<_>>());

        Ok(Self {
            session: Arc::new(Mutex::new(session)),
        })
    }

    /// Run inference with the ONNX model
    /// 
    /// # Arguments
    /// * `inputs` - HashMap of input names to tensors (as ndarray ArrayD<f32>)
    /// 
    /// # Returns
    /// HashMap of output names to tensors (as ndarray ArrayD<f32>)
    pub fn run(&self, inputs: HashMap<String, ArrayD<f32>>) -> Result<HashMap<String, ArrayD<f32>>, String> {
        let mut session = self.session.lock()
            .map_err(|e| format!("Failed to lock session: {}", e))?;

        // Convert inputs to ONNX Runtime format
        let mut ort_inputs = Vec::new();
        for (name, array) in inputs {
            let shape: Vec<i64> = array.shape().iter().map(|&d| d as i64).collect();
            let data: Vec<f32> = array.iter().cloned().collect();
            let tensor = Tensor::from_array((shape.as_slice(), data))
                .map_err(|e| format!("Failed to create tensor for input {}: {}", name, e))?;
            let value: SessionInputValue = SessionInputValue::Owned(Value::from(tensor));
            ort_inputs.push((Cow::Owned(name), value));
        }

        // Run inference
        let outputs: SessionOutputs = session
            .run(SessionInputs::from(ort_inputs))
            .map_err(|e| format!("ONNX Runtime inference failed: {}", e))?;

        // Convert outputs back to ndarray
        let mut result = HashMap::new();
        for (name, value) in outputs.iter() {
            let (shape, data) = value
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Failed to extract tensor for output {}: {}", name, e))?;
            
            let shape_vec: Vec<usize> = shape.iter().map(|&i| i as usize).collect();
            let array = ArrayD::from_shape_vec(shape_vec, data.to_vec())
                .map_err(|e| format!("Failed to create array for output {}: {}", name, e))?;
            result.insert(name.to_string(), array);
        }

        Ok(result)
    }

    /// Run inference with correct types for Kokoro model (tokens as i64, style/speed as f32)
    /// 
    /// # Arguments
    /// * `tokens` - Token array as i64 (shape: [batch, seq_len])
    /// * `style` - Style embedding array as f32 (shape: [batch, style_dim])
    /// * `speed` - Speed scalar as f32 (shape: [1])
    /// 
    /// # Returns
    /// HashMap of output names to tensors (as ndarray ArrayD<f32>)
    pub fn run_kokoro(&self, tokens: ArrayD<i64>, style: ArrayD<f32>, speed: ArrayD<f32>) -> Result<HashMap<String, ArrayD<f32>>, String> {
        use ndarray::ArrayD;
        
        let mut session = self.session.lock()
            .map_err(|e| format!("Failed to lock session: {}", e))?;

        // Convert inputs to ONNX Runtime format
        let mut ort_inputs = Vec::new();
        
        // Tokens as i64 - use array for shape like kokoros does
        let tokens_shape = [tokens.shape()[0], tokens.shape()[1]];
        let tokens_data: Vec<i64> = tokens.iter().cloned().collect();
        let tokens_tensor = Tensor::from_array((tokens_shape, tokens_data))
            .map_err(|e| format!("Failed to create tokens tensor: {}", e))?;
        ort_inputs.push((Cow::Borrowed("tokens"), SessionInputValue::Owned(Value::from(tokens_tensor))));
        
        // Style as f32 - use array for shape
        let style_shape = [style.shape()[0], style.shape()[1]];
        let style_data: Vec<f32> = style.iter().cloned().collect();
        let style_tensor = Tensor::from_array((style_shape, style_data))
            .map_err(|e| format!("Failed to create style tensor: {}", e))?;
        ort_inputs.push((Cow::Borrowed("style"), SessionInputValue::Owned(Value::from(style_tensor))));
        
        // Speed as f32 - use array for shape
        let speed_shape = [1];
        let speed_data: Vec<f32> = speed.iter().cloned().collect();
        let speed_tensor = Tensor::from_array((speed_shape, speed_data))
            .map_err(|e| format!("Failed to create speed tensor: {}", e))?;
        ort_inputs.push((Cow::Borrowed("speed"), SessionInputValue::Owned(Value::from(speed_tensor))));

        // Run inference
        let outputs: SessionOutputs = session
            .run(SessionInputs::from(ort_inputs))
            .map_err(|e| format!("ONNX Runtime inference failed: {}", e))?;

        // Convert outputs back to ndarray
        let mut result = HashMap::new();
        for (name, value) in outputs.iter() {
            let (shape, data) = value
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("Failed to extract tensor for output {}: {}", name, e))?;
            
            let shape_vec: Vec<usize> = shape.iter().map(|&i| i as usize).collect();
            let array = ArrayD::from_shape_vec(shape_vec, data.to_vec())
                .map_err(|e| format!("Failed to create array for output {}: {}", name, e))?;
            result.insert(name.to_string(), array);
        }

        Ok(result)
    }

    /// Get input names
    pub fn input_names(&self) -> Result<Vec<String>, String> {
        let session = self.session.lock()
            .map_err(|e| format!("Failed to lock session: {}", e))?;
        Ok(session.inputs.iter().map(|i| i.name.clone()).collect())
    }

    /// Get output names
    pub fn output_names(&self) -> Result<Vec<String>, String> {
        let session = self.session.lock()
            .map_err(|e| format!("Failed to lock session: {}", e))?;
        Ok(session.outputs.iter().map(|o| o.name.clone()).collect())
    }
}

// Non-Apple platforms: provide stub implementations
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub struct KokoroOnnxCoreML;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use std::collections::HashMap;
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use ndarray::ArrayD;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl KokoroOnnxCoreML {
    pub fn new(_model_path: &str, _use_coreml: bool) -> Result<Self, String> {
        Err("CoreML EP is only available on macOS/iOS".to_string())
    }
    
    pub fn run(&self, _inputs: HashMap<String, ArrayD<f32>>) -> Result<HashMap<String, ArrayD<f32>>, String> {
        Err("CoreML EP is only available on macOS/iOS".to_string())
    }
    
    pub fn input_names(&self) -> Result<Vec<String>, String> {
        Err("CoreML EP is only available on macOS/iOS".to_string())
    }
    
    pub fn output_names(&self) -> Result<Vec<String>, String> {
        Err("CoreML EP is only available on macOS/iOS".to_string())
    }
}

