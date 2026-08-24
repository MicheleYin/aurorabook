// AudiobookExporter.swift
// AVFoundation bridge for App Store–safe M4A / M4B export (no FFmpeg / no subprocess).
//
// Rust calls `aurora_export_audiobook` (blocking). Progress/cancel go through
// `on_aurora_export_progress` / `aurora_export_is_cancelled` symbols in Rust.

import AVFoundation
import Foundation

@_silgen_name("on_aurora_export_progress")
private func rustExportProgress(percent: UInt8)

@_silgen_name("aurora_export_is_cancelled")
private func rustExportIsCancelled() -> Bool

private enum AuroraExportError: Error {
    case invalidJSON
    case noTracks
    case compositionFailed(String)
    case exportFailed(String)
    case cancelled
}

private final class AudiobookExporter {
    static let shared = AudiobookExporter()
    static var lastErrorMessage: String = ""

    /// iOS save dialogs often return `file:///…/Name%20Here.m4a`. Convert to a
    /// filesystem path AVFoundation / FileManager can use.
    private func filesystemPath(from raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.lowercased().hasPrefix("file:"),
           let url = URL(string: trimmed)
        {
            return url.path
        }
        if let decoded = trimmed.removingPercentEncoding {
            return decoded
        }
        return trimmed
    }

    func export(
        trackPaths: [String],
        chapterTitles: [String],
        format: String,
        title: String,
        artist: String,
        album: String,
        outputPath: String
    ) throws {
        Self.lastErrorMessage = ""
        if rustExportIsCancelled() { throw AuroraExportError.cancelled }
        guard !trackPaths.isEmpty else { throw AuroraExportError.noTracks }

        rustExportProgress(percent: 5)

        let composition = AVMutableComposition()
        guard let compTrack = composition.addMutableTrack(
            withMediaType: .audio,
            preferredTrackID: kCMPersistentTrackID_Invalid
        ) else {
            throw AuroraExportError.compositionFailed("Could not create composition track")
        }

        var cursor = CMTime.zero
        var chapterStarts: [Double] = []
        let titles: [String] = {
            if chapterTitles.count == trackPaths.count {
                return chapterTitles
            }
            return trackPaths.enumerated().map { idx, _ in "Chapter \(idx + 1)" }
        }()

        for (index, path) in trackPaths.enumerated() {
            if rustExportIsCancelled() { throw AuroraExportError.cancelled }

            let resolved = filesystemPath(from: path)
            let url = URL(fileURLWithPath: resolved)
            guard FileManager.default.fileExists(atPath: resolved) else {
                throw AuroraExportError.compositionFailed(
                    "Track file missing: \(resolved)"
                )
            }
            let asset = AVURLAsset(url: url)
            let sourceTrack = try loadFirstAudioTrack(from: asset, path: resolved)
            let duration = try loadDuration(of: asset, fallbackTrack: sourceTrack)
            let timeRange = CMTimeRange(start: .zero, duration: duration)
            chapterStarts.append(CMTimeGetSeconds(cursor))

            do {
                try compTrack.insertTimeRange(timeRange, of: sourceTrack, at: cursor)
            } catch {
                throw AuroraExportError.compositionFailed(
                    "Failed to insert track \(index + 1): \(error.localizedDescription)"
                )
            }
            cursor = CMTimeAdd(cursor, duration)

            let prepPercent = 5 + UInt8(min(35, (index + 1) * 35 / trackPaths.count))
            rustExportProgress(percent: prepPercent)
        }

        if rustExportIsCancelled() { throw AuroraExportError.cancelled }

        // Caller (Rust) always passes a sandbox temp path. Placement into the
        // user-chosen File Provider URL happens via ExportFileWriter afterward.
        let finalPath = filesystemPath(from: outputPath)
        let finalURL = URL(fileURLWithPath: finalPath)
        let parent = finalURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parent,
            withIntermediateDirectories: true
        )
        if FileManager.default.fileExists(atPath: finalPath) {
            try? FileManager.default.removeItem(at: finalURL)
        }

        // Prefer Apple M4A preset (AAC). Output extension may be .m4a or .m4b.
        guard let session = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPresetAppleM4A
        ) else {
            throw AuroraExportError.exportFailed("AVAssetExportSession unavailable")
        }

        session.outputURL = finalURL
        session.outputFileType = .m4a
        session.metadata = buildMetadata(
            title: title,
            artist: artist,
            album: album.isEmpty ? title : album,
            format: format,
            chapterTitles: titles,
            chapterStarts: chapterStarts,
            totalDuration: CMTimeGetSeconds(cursor)
        )

        rustExportProgress(percent: 45)

        let group = DispatchGroup()
        var exportError: Error?
        group.enter()

        let progressTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.global())
        progressTimer.schedule(deadline: .now(), repeating: .milliseconds(200))
        progressTimer.setEventHandler {
            if rustExportIsCancelled() {
                session.cancelExport()
                return
            }
            let p = session.progress
            if p > 0 {
                let mapped = 45 + UInt8(min(50, Int(p * 50.0)))
                rustExportProgress(percent: mapped)
            }
        }
        progressTimer.resume()

        session.exportAsynchronously {
            defer {
                progressTimer.cancel()
                group.leave()
            }
            switch session.status {
            case .completed:
                break
            case .cancelled:
                exportError = AuroraExportError.cancelled
            case .failed:
                exportError = AuroraExportError.exportFailed(
                    session.error?.localizedDescription ?? "export failed"
                )
            default:
                exportError = AuroraExportError.exportFailed(
                    "Unexpected export status: \(session.status.rawValue)"
                )
            }
        }

        group.wait()

        if let exportError {
            try? FileManager.default.removeItem(at: finalURL)
            throw exportError
        }
        if rustExportIsCancelled() {
            try? FileManager.default.removeItem(at: finalURL)
            throw AuroraExportError.cancelled
        }

        rustExportProgress(percent: 100)
    }

    /// Ensure asset tracks are loaded, then return the first audio track.
    /// Uses `loadValuesAsynchronously` so we do not rely on deprecated sync accessors
    /// that can return empty before keys are ready.
    private func loadFirstAudioTrack(from asset: AVURLAsset, path: String) throws -> AVAssetTrack {
        try loadAssetKeys(asset, keys: ["tracks"])
        let audioTracks = asset.tracks(withMediaType: .audio)
        guard let sourceTrack = audioTracks.first else {
            throw AuroraExportError.compositionFailed("No audio track in file: \(path)")
        }
        return sourceTrack
    }

    private func loadDuration(of asset: AVURLAsset, fallbackTrack: AVAssetTrack) throws -> CMTime {
        try? loadAssetKeys(asset, keys: ["duration"])
        let duration = asset.duration
        if duration.isValid && !duration.isIndefinite && CMTimeGetSeconds(duration) > 0 {
            return duration
        }
        let trackDuration = fallbackTrack.timeRange.duration
        if trackDuration.isValid && CMTimeGetSeconds(trackDuration) > 0 {
            return trackDuration
        }
        throw AuroraExportError.compositionFailed("Could not determine track duration")
    }

    private func loadAssetKeys(_ asset: AVURLAsset, keys: [String]) throws {
        let group = DispatchGroup()
        var loadError: Error?
        group.enter()
        asset.loadValuesAsynchronously(forKeys: keys) {
            defer { group.leave() }
            for key in keys {
                var statusError: NSError?
                let status = asset.statusOfValue(forKey: key, error: &statusError)
                if status == .failed || status == .cancelled {
                    loadError = statusError
                    return
                }
            }
        }
        group.wait()
        if let loadError {
            throw AuroraExportError.compositionFailed(
                "Failed to load asset keys \(keys): \(loadError.localizedDescription)"
            )
        }
    }

    private func buildMetadata(
        title: String,
        artist: String,
        album: String,
        format: String,
        chapterTitles: [String],
        chapterStarts: [Double],
        totalDuration: Double
    ) -> [AVMetadataItem] {
        var items: [AVMutableMetadataItem] = []

        func item(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMutableMetadataItem {
            let m = AVMutableMetadataItem()
            m.identifier = identifier
            m.value = value as NSString
            m.extendedLanguageTag = "und"
            return m
        }

        items.append(item(.commonIdentifierTitle, title))
        items.append(item(.commonIdentifierArtist, artist))
        items.append(item(.commonIdentifierAlbumName, album))

        // iTunes `stik` (media kind). AVMetadataIdentifier has no MediaType member;
        // value 2 = Audiobook, 1 = Normal/Music-style audio.
        if format.lowercased() == "m4b" {
            let mediaKind = AVMutableMetadataItem()
            mediaKind.keySpace = .iTunes
            mediaKind.key = "stik" as NSString
            mediaKind.value = NSNumber(value: Int8(2))
            mediaKind.dataType = kCMMetadataBaseDataType_SInt8 as String
            mediaKind.extendedLanguageTag = "und"
            items.append(mediaKind)
        }

        // Embed chapter list as readable description for players that ignore QT chapter tracks.
        if format.lowercased() == "m4b", !chapterTitles.isEmpty {
            var lines: [String] = []
            for (i, name) in chapterTitles.enumerated() {
                let start = i < chapterStarts.count ? chapterStarts[i] : 0
                let end: Double = {
                    if i + 1 < chapterStarts.count {
                        return chapterStarts[i + 1]
                    }
                    return totalDuration
                }()
                lines.append(String(format: "%@ (%.1fs–%.1fs)", name, start, end))
            }
            items.append(item(.commonIdentifierDescription, lines.joined(separator: "\n")))
        }

        // Timed chapter markers (QuickTime-style) where supported by the export pipeline.
        for (i, name) in chapterTitles.enumerated() {
            guard i < chapterStarts.count else { break }
            let start = chapterStarts[i]
            let end: Double = {
                if i + 1 < chapterStarts.count {
                    return chapterStarts[i + 1]
                }
                return max(totalDuration, start)
            }()
            let duration = max(0.01, end - start)

            let chapter = AVMutableMetadataItem()
            chapter.identifier = .quickTimeUserDataChapter
            chapter.value = name as NSString
            chapter.extendedLanguageTag = "und"
            chapter.time = CMTime(seconds: start, preferredTimescale: 1000)
            chapter.duration = CMTime(seconds: duration, preferredTimescale: 1000)
            items.append(chapter)
        }

        return items
    }
}

/// Blocking export entry point called from Rust (`spawn_blocking`).
/// Returns 0 on success, non-zero on failure (see message via stderr / Rust mapping).
@_cdecl("aurora_export_audiobook")
public func auroraExportAudiobook(
    trackPathsJson: UnsafePointer<CChar>,
    chapterTitlesJson: UnsafePointer<CChar>,
    format: UnsafePointer<CChar>,
    title: UnsafePointer<CChar>,
    artist: UnsafePointer<CChar>,
    album: UnsafePointer<CChar>,
    outputPath: UnsafePointer<CChar>
) -> Int32 {
    let pathsStr = String(cString: trackPathsJson)
    let titlesStr = String(cString: chapterTitlesJson)
    let formatStr = String(cString: format)
    let titleStr = String(cString: title)
    let artistStr = String(cString: artist)
    let albumStr = String(cString: album)
    let outputStr = String(cString: outputPath)

    guard
        let pathsData = pathsStr.data(using: .utf8),
        let titlesData = titlesStr.data(using: .utf8),
        let paths = try? JSONDecoder().decode([String].self, from: pathsData),
        let titles = try? JSONDecoder().decode([String].self, from: titlesData)
    else {
        AudiobookExporter.lastErrorMessage = "invalid JSON payloads"
        NSLog("[AudiobookExporter] invalid JSON payloads")
        return 1
    }

    do {
        try AudiobookExporter.shared.export(
            trackPaths: paths,
            chapterTitles: titles,
            format: formatStr,
            title: titleStr,
            artist: artistStr,
            album: albumStr,
            outputPath: outputStr
        )
        return 0
    } catch AuroraExportError.cancelled {
        AudiobookExporter.lastErrorMessage = "cancelled"
        NSLog("[AudiobookExporter] cancelled")
        return 2
    } catch {
        AudiobookExporter.lastErrorMessage = error.localizedDescription
        NSLog("[AudiobookExporter] error: %@", error.localizedDescription)
        return 3
    }
}

/// UTF-8 C string of the last export failure; caller must free with `aurora_export_free_string`.
@_cdecl("aurora_export_last_error")
public func auroraExportLastError() -> UnsafeMutablePointer<CChar>? {
    let msg = AudiobookExporter.lastErrorMessage
    guard !msg.isEmpty else { return nil }
    return strdup(msg)
}

@_cdecl("aurora_export_free_string")
public func auroraExportFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
