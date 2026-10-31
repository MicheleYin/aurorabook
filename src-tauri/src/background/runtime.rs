//! Platform background runtime bootstrap and event loop.

use serde::Serialize;

/// Serializable capability flags for the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCapabilitiesDto {
    pub supports_app_refresh: bool,
    pub supports_processing: bool,
    pub supports_continued_processing: bool,
    pub supports_continued_processing_gpu: bool,
    pub supports_launch_events: bool,
    pub is_ios: bool,
}

impl BackgroundCapabilitiesDto {
    pub fn unsupported() -> Self {
        Self {
            supports_app_refresh: false,
            supports_processing: false,
            supports_continued_processing: false,
            supports_continued_processing_gpu: false,
            supports_launch_events: false,
            is_ios: cfg!(target_os = "ios"),
        }
    }
}

pub fn query_capabilities() -> BackgroundCapabilitiesDto {
    BackgroundCapabilitiesDto::unsupported()
}

#[cfg(test)]
mod tests {
    use super::{query_capabilities, BackgroundCapabilitiesDto};

    #[test]
    fn unsupported_capabilities_disable_everything() {
        let caps = BackgroundCapabilitiesDto::unsupported();

        assert!(!caps.supports_app_refresh);
        assert!(!caps.supports_processing);
        assert!(!caps.supports_continued_processing);
        assert!(!caps.supports_continued_processing_gpu);
        assert!(!caps.supports_launch_events);
        assert_eq!(caps.is_ios, cfg!(target_os = "ios"));
    }

    #[test]
    fn query_capabilities_matches_platform_shape() {
        let caps = query_capabilities();

        #[cfg(not(target_os = "ios"))]
        {
            assert!(!caps.supports_app_refresh);
            assert!(!caps.supports_processing);
            assert!(!caps.supports_continued_processing);
            assert!(!caps.supports_continued_processing_gpu);
            assert!(!caps.supports_launch_events);
            assert!(!caps.is_ios);
        }

        #[cfg(target_os = "ios")]
        {
            assert!(caps.is_ios);
        }
    }
}
