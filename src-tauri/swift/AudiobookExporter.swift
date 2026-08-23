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

    func export(
        trackPaths: [String],
        chapterTitles: [String],
        format: String,
        title: String,
        artist: String,
        album: String,
        outputPath: String
    ) throws {
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

            let url = URL(fileURLWithPath: path)
            let asset = AVURLAsset(url: url)
            let audioTracks = asset.tracks(withMediaType: .audio)
            guard let sourceTrack = audioTracks.first else {
                throw AuroraExportError.compositionFailed(
                    "No audio track in file: \(path)"
                )
            }

            let duration = sourceTrack.timeRange.duration
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

        let outputURL = URL(fileURLWithPath: outputPath)
        if FileManager.default.fileExists(atPath: outputPath) {
            try? FileManager.default.removeItem(at: outputURL)
        }

        // Prefer Apple M4A preset (AAC). Output extension may be .m4a or .m4b.
        guard let session = AVAssetExportSession(
            asset: composition,
            presetName: AVAssetExportPresetAppleM4A
        ) else {
            throw AuroraExportError.exportFailed("AVAssetExportSession unavailable")
        }

        session.outputURL = outputURL
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
            throw exportError
        }
        if rustExportIsCancelled() {
            try? FileManager.default.removeItem(at: outputURL)
            throw AuroraExportError.cancelled
        }

        rustExportProgress(percent: 100)
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
        items.append(item(.iTunesMetadataMediaType, format.lowercased() == "m4b" ? "Audiobook" : "Audio"))

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
        NSLog("[AudiobookExporter] cancelled")
        return 2
    } catch {
        NSLog("[AudiobookExporter] error: %@", error.localizedDescription)
        return 3
    }
}
