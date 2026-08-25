// ExportFileWriter.swift
// Place an already-written sandbox file into a user-chosen destination.
//
// iOS save dialogs return security-scoped `file://` URLs under File Provider
// Storage. Those paths are not reliably writable with Rust `std::fs` (ENOENT).
// This helper uses URL APIs + security scope + NSFileCoordinator.

import Foundation

private enum PlaceError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let s):
            return s
        }
    }
}

private final class ExportFileWriter {
    static let shared = ExportFileWriter()
    static var lastErrorMessage: String = ""

    func destinationURL(from raw: String) throws -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("file:") {
            guard let url = URL(string: trimmed) else {
                throw PlaceError.message("Invalid file URL: \(trimmed)")
            }
            return url
        }
        let path = trimmed.removingPercentEncoding ?? trimmed
        guard !path.isEmpty else {
            throw PlaceError.message("Empty export destination path")
        }
        return URL(fileURLWithPath: path)
    }

    func place(sourcePath: String, destinationRaw: String) throws {
        Self.lastErrorMessage = ""
        let sourceURL = URL(fileURLWithPath: sourcePath)
        guard FileManager.default.fileExists(atPath: sourcePath) else {
            throw PlaceError.message("Export temp file missing: \(sourcePath)")
        }

        let destURL = try destinationURL(from: destinationRaw)
        let parentURL = destURL.deletingLastPathComponent()
        let accessingFile = destURL.startAccessingSecurityScopedResource()
        let accessingParent = parentURL.startAccessingSecurityScopedResource()
        defer {
            if accessingFile {
                destURL.stopAccessingSecurityScopedResource()
            }
            if accessingParent {
                parentURL.stopAccessingSecurityScopedResource()
            }
        }

        NSLog(
            "[ExportFileWriter] place source=%@ dest=%@ scopedFile=%@ scopedParent=%@",
            sourcePath,
            destURL.absoluteString,
            accessingFile ? "yes" : "no",
            accessingParent ? "yes" : "no"
        )

        var coordinatorError: NSError?
        var operationError: Error?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(
            writingItemAt: destURL,
            options: .forReplacing,
            error: &coordinatorError
        ) { writableURL in
            do {
                let parent = writableURL.deletingLastPathComponent()
                try FileManager.default.createDirectory(
                    at: parent,
                    withIntermediateDirectories: true
                )
                if FileManager.default.fileExists(atPath: writableURL.path) {
                    try FileManager.default.removeItem(at: writableURL)
                }
                try FileManager.default.copyItem(at: sourceURL, to: writableURL)
            } catch {
                operationError = error
            }
        }

        if let coordinatorError {
            throw PlaceError.message(
                "File coordination failed: \(coordinatorError.localizedDescription)"
            )
        }
        if let operationError {
            throw PlaceError.message(operationError.localizedDescription)
        }
    }
}

/// Copy `sourcePath` to `destinationPathOrUrl` (filesystem path or `file://` URL).
/// Returns 0 on success, non-zero on failure.
@_cdecl("aurora_place_export_file")
public func auroraPlaceExportFile(
    sourcePath: UnsafePointer<CChar>,
    destinationPathOrUrl: UnsafePointer<CChar>
) -> Int32 {
    let source = String(cString: sourcePath)
    let dest = String(cString: destinationPathOrUrl)
    do {
        try ExportFileWriter.shared.place(sourcePath: source, destinationRaw: dest)
        return 0
    } catch {
        ExportFileWriter.lastErrorMessage = error.localizedDescription
        NSLog("[ExportFileWriter] %@", error.localizedDescription)
        return 1
    }
}

@_cdecl("aurora_place_export_last_error")
public func auroraPlaceExportLastError() -> UnsafeMutablePointer<CChar>? {
    let msg = ExportFileWriter.lastErrorMessage
    guard !msg.isEmpty else { return nil }
    return strdup(msg)
}

@_cdecl("aurora_place_export_free_string")
public func auroraPlaceExportFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
