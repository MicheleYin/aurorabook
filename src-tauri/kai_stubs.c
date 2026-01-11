// Stub implementations for kai_* ARM SME symbols
// These are referenced by XNNPACK microkernels but may not be available on all iOS devices
// Using weak symbols so they can be overridden if the actual implementations are available

#ifdef __APPLE__
#include <stdint.h>

// Weak attribute for iOS/macOS
__attribute__((weak)) uint32_t kai_get_lhs_packed_offset_lhs_pack_f32p2vlx1_f32_sme(void) { return 0; }
__attribute__((weak)) uint32_t kai_get_lhs_packed_offset_lhs_pack_x16p2vlx2_x16_sme(void) { return 0; }
__attribute__((weak)) uint32_t kai_get_lhs_packed_offset_lhs_pack_x8p2vlx4_x8_sme(void) { return 0; }
__attribute__((weak)) uint32_t kai_get_lhs_packed_size_lhs_pack_f32p2vlx1_f32_sme(void) { return 0; }
__attribute__((weak)) uint32_t kai_get_lhs_packed_size_lhs_pack_x16p2vlx2_x16_sme(void) { return 0; }
__attribute__((weak)) uint32_t kai_get_lhs_packed_size_lhs_pack_x8p2vlx4_x8_sme(void) { return 0; }
__attribute__((weak)) void kai_run_lhs_pack_f32p2vlx1_f32_sme(void* dst, const void* src, uint32_t size) { }
__attribute__((weak)) void kai_run_lhs_pack_x16p2vlx2_x16_sme(void* dst, const void* src, uint32_t size) { }
__attribute__((weak)) void kai_run_lhs_pack_x8p2vlx4_x8_sme(void* dst, const void* src, uint32_t size) { }

#endif
