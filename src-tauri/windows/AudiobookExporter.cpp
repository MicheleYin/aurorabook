#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <string>

using Microsoft::WRL::ComPtr;

typedef int (*AuroraCancelCallback)(void*);
typedef void (*AuroraProgressCallback)(void*, size_t, unsigned int);

static int fail(char* error, size_t error_capacity, const char* operation, HRESULT hr) {
    if (error && error_capacity > 0) {
        std::snprintf(error, error_capacity, "%s failed (HRESULT 0x%08lx)", operation,
                      static_cast<unsigned long>(hr));
    }
    return static_cast<int>(hr);
}

extern "C" int aurora_mf_export_aac(
    const wchar_t* const* input_paths,
    const double* duration_hints,
    size_t input_count,
    const wchar_t* output_path,
    int64_t* chapter_starts_100ns,
    AuroraCancelCallback is_cancelled,
    AuroraProgressCallback report_progress,
    void* callback_context,
    char* error,
    size_t error_capacity) {
    if (!input_paths || !output_path || input_count == 0) {
        if (error && error_capacity) std::snprintf(error, error_capacity, "No audio tracks to export");
        return E_INVALIDARG;
    }

    const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool uninitialize_com = SUCCEEDED(com_result);
    if (FAILED(com_result) && com_result != RPC_E_CHANGED_MODE) {
        return fail(error, error_capacity, "COM initialization", com_result);
    }

    HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(hr)) {
        if (uninitialize_com) CoUninitialize();
        return fail(error, error_capacity, "Media Foundation startup", hr);
    }

    int result = 0;
    ComPtr<IMFSinkWriter> writer;
    DWORD stream_index = 0;
    uint64_t total_frames = 0;

    do {
        if (output_path[0] == L'\0') {
            result = fail(error, error_capacity, "Output path conversion", E_INVALIDARG);
            break;
        }
        hr = MFCreateSinkWriterFromURL(output_path, nullptr, nullptr, &writer);
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Create AAC sink writer", hr);
            break;
        }

        ComPtr<IMFMediaType> output_type;
        hr = MFCreateMediaType(&output_type);
        if (SUCCEEDED(hr)) hr = output_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
        if (SUCCEEDED(hr)) hr = output_type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
        if (SUCCEEDED(hr)) hr = output_type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2);
        if (SUCCEEDED(hr)) hr = output_type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 44100);
        if (SUCCEEDED(hr)) hr = output_type->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16000);
        if (SUCCEEDED(hr)) hr = output_type->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Configure AAC output", hr);
            break;
        }
        hr = writer->AddStream(output_type.Get(), &stream_index);
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Find Windows AAC encoder", hr);
            break;
        }

        ComPtr<IMFMediaType> input_type;
        hr = MFCreateMediaType(&input_type);
        if (SUCCEEDED(hr)) hr = input_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
        if (SUCCEEDED(hr)) hr = input_type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 44100);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 4);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 176400);
        if (SUCCEEDED(hr)) hr = input_type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Configure PCM input", hr);
            break;
        }
        hr = writer->SetInputMediaType(stream_index, input_type.Get(), nullptr);
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Configure AAC encoder input", hr);
            break;
        }
        hr = writer->BeginWriting();
        if (FAILED(hr)) {
            result = fail(error, error_capacity, "Start AAC encoding", hr);
            break;
        }

        for (size_t track = 0; track < input_count; ++track) {
            if (is_cancelled && is_cancelled(callback_context)) {
                result = static_cast<int>(HRESULT_FROM_WIN32(ERROR_CANCELLED));
                if (error && error_capacity) std::snprintf(error, error_capacity, "Audio export cancelled");
                break;
            }

            if (!input_paths[track] || input_paths[track][0] == L'\0') {
                result = fail(error, error_capacity, "Input path conversion", E_INVALIDARG);
                break;
            }

            ComPtr<IMFSourceReader> reader;
            hr = MFCreateSourceReaderFromURL(input_paths[track], nullptr, &reader);
            if (FAILED(hr)) {
                result = fail(error, error_capacity, "Open audio track", hr);
                break;
            }
            hr = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, input_type.Get());
            if (FAILED(hr)) {
                result = fail(error, error_capacity, "Decode audio track to PCM", hr);
                break;
            }

            uint64_t track_frames = 0;
            for (;;) {
                if (is_cancelled && is_cancelled(callback_context)) {
                    result = static_cast<int>(HRESULT_FROM_WIN32(ERROR_CANCELLED));
                    if (error && error_capacity) std::snprintf(error, error_capacity, "Audio export cancelled");
                    break;
                }

                DWORD flags = 0;
                ComPtr<IMFSample> sample;
                hr = reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, nullptr, &sample);
                if (FAILED(hr)) {
                    result = fail(error, error_capacity, "Read decoded audio sample", hr);
                    break;
                }
                if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) break;
                if (!sample) continue;

                ComPtr<IMFMediaBuffer> buffer;
                hr = sample->ConvertToContiguousBuffer(&buffer);
                if (FAILED(hr)) {
                    result = fail(error, error_capacity, "Read PCM buffer", hr);
                    break;
                }
                DWORD length = 0;
                hr = buffer->GetCurrentLength(&length);
                if (FAILED(hr) || length == 0) continue;
                if (length % 4 != 0) {
                    result = fail(error, error_capacity, "Validate PCM frame alignment", E_FAIL);
                    break;
                }

                const uint64_t frames = length / 4;
                const LONGLONG timestamp = static_cast<LONGLONG>(total_frames * 10000000ULL / 44100ULL);
                const LONGLONG sample_duration = static_cast<LONGLONG>(frames * 10000000ULL / 44100ULL);
                hr = sample->SetSampleTime(timestamp);
                if (SUCCEEDED(hr)) hr = sample->SetSampleDuration(sample_duration);
                if (SUCCEEDED(hr)) hr = writer->WriteSample(stream_index, sample.Get());
                if (FAILED(hr)) {
                    result = fail(error, error_capacity, "Write AAC sample", hr);
                    break;
                }
                total_frames += frames;
                track_frames += frames;

                if (report_progress && duration_hints && duration_hints[track] > 0.0) {
                    const double written = static_cast<double>(track_frames) / 44100.0;
                    const unsigned int percent = static_cast<unsigned int>(
                        std::min(99.0, written * 100.0 / duration_hints[track]));
                    report_progress(callback_context, track, percent);
                }
            }
            if (result != 0) break;
            if (chapter_starts_100ns) {
                chapter_starts_100ns[track] = static_cast<int64_t>(
                    (total_frames - track_frames) * 10000000ULL / 44100ULL);
            }
            if (report_progress) report_progress(callback_context, track, 100);
        }
    } while (false);

    if (writer) {
        const HRESULT finalize_hr = writer->Finalize();
        if (result == 0 && FAILED(finalize_hr)) {
            result = fail(error, error_capacity, "Finalize AAC output", finalize_hr);
        }
    }
    writer.Reset();
    MFShutdown();
    if (uninitialize_com) CoUninitialize();
    return result;
}