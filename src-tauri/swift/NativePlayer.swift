// NativePlayer.swift
// Bridges AVFoundation ↔ Rust for native audio playback on iOS.
//
// Why this exists:
//   The Tauri WebView uses a local HTTP server to stream audio. iOS aggressively
//   suspends that server when the app is backgrounded, killing audio and making
//   lock-screen controls non-functional. AVPlayer + AVAudioSession + MPRemoteCommandCenter
//   run natively, survive backgrounding, and integrate with the iOS lock screen / Control
//   Centre without needing the server to be alive.
//
// Live chapters:
//   Rust appends synthesized MP3 into a growing file. When the file extends we reload
//   the AVPlayerItem (preserving position) so playback can continue past the previous EOF.
//
// Bridge pattern:
//   Rust declares `extern "C"` stubs for the `aurora_player_*` functions exported by
//   this file via `@_cdecl`. Swift calls the Rust callback `on_native_player_event`
//   using `@_silgen_name` (zero-overhead ABI-compatible call into the linked Rust binary).

import AVFoundation
import Foundation
import MediaPlayer
import UIKit

// ─── Rust callback declaration ────────────────────────────────────────────────

/// Reference to the Rust `on_native_player_event(event_type: u8, value: f64)` symbol.
/// Called whenever a remote-control command or playback state change occurs.
///
/// Event types:
///   1 play · 2 pause · 3 seek(value=seconds) · 4 next · 5 prev
///   6 timeUpdate(value=seconds) · 7 ended · 8 durationUpdate(value=seconds)
@_silgen_name("on_native_player_event")
private func rustPlayerCallback(eventType: UInt8, value: Double)

// ─── Player singleton ─────────────────────────────────────────────────────────

private final class AuroraPlayer: NSObject {
    static let shared = AuroraPlayer()

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObserver: NSKeyValueObservation?
    private var interruptionObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?

    private var loadedFilePath: String = ""
    private var expectsMoreContent = false
    private var waitingForMoreContent = false
    private var wantsPlaying = false
    private var pendingSeekSeconds: Double? = nil
    private var coverArtwork: MPMediaItemArtwork?

    // Metadata for MPNowPlayingInfoCenter
    private var metaTitle = ""
    private var metaArtist = ""
    private var metaDuration: Double = 0

    private override init() {
        super.init()
        configureAudioSession()
        registerRemoteCommands()
        registerInterruptionObservers()
    }

    // MARK: — Audio session

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.allowBluetooth, .allowAirPlay, .allowBluetoothA2DP]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[AuroraPlayer] AVAudioSession error: %@", error.localizedDescription)
        }
    }

    private func activateSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[AuroraPlayer] setActive error: %@", error.localizedDescription)
        }
    }

    private func registerInterruptionObservers() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let self else { return }
            guard
                let info = note.userInfo,
                let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: typeValue)
            else { return }

            switch type {
            case .began:
                self.player?.pause()
                self.updateNowPlaying(elapsed: self.currentTime())
                rustPlayerCallback(eventType: 2, value: 0)
            case .ended:
                let optionsValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume), self.wantsPlaying {
                    self.activateSession()
                    self.play()
                    rustPlayerCallback(eventType: 1, value: 0)
                }
            @unknown default:
                break
            }
        }

        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let self else { return }
            guard
                let info = note.userInfo,
                let reasonValue = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
                let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue)
            else { return }

            if reason == .oldDeviceUnavailable {
                self.player?.pause()
                self.wantsPlaying = false
                self.updateNowPlaying(elapsed: self.currentTime())
                rustPlayerCallback(eventType: 2, value: 0)
            }
        }
    }

    // MARK: — Remote command centre

    private func registerRemoteCommands() {
        let cc = MPRemoteCommandCenter.shared()

        cc.playCommand.isEnabled = true
        cc.playCommand.addTarget { [weak self] _ in
            self?.play()
            rustPlayerCallback(eventType: 1, value: 0)
            return .success
        }

        cc.pauseCommand.isEnabled = true
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            rustPlayerCallback(eventType: 2, value: 0)
            return .success
        }

        cc.togglePlayPauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.player?.timeControlStatus == .playing {
                self.pause()
                rustPlayerCallback(eventType: 2, value: 0)
            } else {
                self.play()
                rustPlayerCallback(eventType: 1, value: 0)
            }
            return .success
        }

        cc.changePlaybackPositionCommand.isEnabled = true
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let posEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.seek(to: posEvent.positionTime)
            rustPlayerCallback(eventType: 3, value: posEvent.positionTime)
            return .success
        }

        cc.nextTrackCommand.isEnabled = true
        cc.nextTrackCommand.addTarget { _ in
            rustPlayerCallback(eventType: 4, value: 0)
            return .success
        }

        cc.previousTrackCommand.isEnabled = true
        cc.previousTrackCommand.addTarget { _ in
            rustPlayerCallback(eventType: 5, value: 0)
            return .success
        }

        cc.skipForwardCommand.isEnabled = true
        cc.skipForwardCommand.preferredIntervals = [30]
        cc.skipForwardCommand.addTarget { [weak self] event in
            guard let skipEvent = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            let t = (self?.currentTime() ?? 0) + skipEvent.interval
            self?.seek(to: t)
            rustPlayerCallback(eventType: 3, value: t)
            return .success
        }

        cc.skipBackwardCommand.isEnabled = true
        cc.skipBackwardCommand.preferredIntervals = [15]
        cc.skipBackwardCommand.addTarget { [weak self] event in
            guard let skipEvent = event as? MPSkipIntervalCommandEvent else { return .commandFailed }
            let t = max(0, (self?.currentTime() ?? 0) - skipEvent.interval)
            self?.seek(to: t)
            rustPlayerCallback(eventType: 3, value: t)
            return .success
        }
    }

    // MARK: — Load

    func load(
        filePath: String,
        title: String,
        artist: String,
        duration: Double,
        expectsMore: Bool,
        coverPath: String
    ) {
        tearDownObservers()

        loadedFilePath = filePath
        metaTitle = title
        metaArtist = artist
        metaDuration = duration
        expectsMoreContent = expectsMore
        waitingForMoreContent = false
        coverArtwork = Self.makeArtwork(from: coverPath)

        replaceItem(preservingTime: 0, andPlay: false)
        updateNowPlaying(elapsed: 0)
        rustPlayerCallback(eventType: 8, value: duration)
    }

    private static func makeArtwork(from coverPath: String) -> MPMediaItemArtwork? {
        guard !coverPath.isEmpty else { return nil }
        guard let image = UIImage(contentsOfFile: coverPath) else {
            NSLog("[AuroraPlayer] failed to load cover at %@", coverPath)
            return nil
        }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    /// Called when Rust has appended more bytes to the same live file.
    func notifyFileExtended(duration: Double) {
        let previousDuration = metaDuration
        metaDuration = max(metaDuration, duration)
        rustPlayerCallback(eventType: 8, value: metaDuration)
        updateNowPlaying(elapsed: currentTime())

        let shouldResume =
            waitingForMoreContent
            || (wantsPlaying && currentTime() >= max(0, previousDuration - 0.35))

        if shouldResume, metaDuration > previousDuration + 0.05 {
            let resumeAt = min(currentTime(), max(0, previousDuration - 0.05))
            waitingForMoreContent = false
            replaceItem(preservingTime: resumeAt, andPlay: wantsPlaying)
        } else {
            updateNowPlaying(elapsed: currentTime())
        }
    }

    func setExpectsMoreContent(_ expectsMore: Bool) {
        expectsMoreContent = expectsMore
        if !expectsMore, waitingForMoreContent {
            // Conversion finished while we were waiting at EOF → treat as true end.
            waitingForMoreContent = false
            wantsPlaying = false
            rustPlayerCallback(eventType: 7, value: 0)
        }
    }

    private func replaceItem(preservingTime seconds: Double, andPlay: Bool) {
        guard !loadedFilePath.isEmpty else { return }

        // Empty files cannot be played; keep waiting for live bytes.
        let attrs = try? FileManager.default.attributesOfItem(atPath: loadedFilePath)
        let fileSize = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        if fileSize <= 0 {
            NSLog("[AuroraPlayer] skip load — empty file %@", loadedFilePath)
            return
        }

        tearDownItemObservers()

        let url = URL(fileURLWithPath: loadedFilePath)
        let item = AVPlayerItem(url: url)

        if player == nil {
            player = AVPlayer(playerItem: item)
            player?.automaticallyWaitsToMinimizeStalling = false
        } else {
            player?.replaceCurrentItem(with: item)
        }

        if andPlay {
            wantsPlaying = true
        }
        if seconds > 0.05 {
            pendingSeekSeconds = seconds
        } else {
            pendingSeekSeconds = nil
        }

        attachObservers(to: item)
        // Actual play/seek happens once status == .readyToPlay.
    }

    // MARK: — Controls

    func play() {
        wantsPlaying = true
        waitingForMoreContent = false
        activateSession()
        playIfReady()
        updateNowPlaying(elapsed: currentTime())
    }

    func pause() {
        wantsPlaying = false
        waitingForMoreContent = false
        player?.pause()
        updateNowPlaying(elapsed: currentTime())
    }

    func seek(to seconds: Double) {
        let clamped = max(0, seconds)
        pendingSeekSeconds = clamped
        waitingForMoreContent = false
        if player?.currentItem?.status == .readyToPlay {
            applyPendingSeekAndMaybePlay()
        }
        updateNowPlaying(elapsed: clamped)
    }

    func setRate(_ rate: Float) {
        if rate == 0 {
            player?.pause()
            wantsPlaying = false
        } else if player?.currentItem?.status == .readyToPlay {
            player?.rate = rate
            wantsPlaying = true
        } else {
            wantsPlaying = true
        }
        updateNowPlaying(elapsed: currentTime())
    }

    func currentTime() -> Double {
        let seconds = player?.currentTime().seconds ?? 0
        return seconds.isFinite ? seconds : 0
    }

    func isPlaying() -> Bool {
        return player?.timeControlStatus == .playing
    }

    private func playIfReady() {
        guard let item = player?.currentItem else {
            NSLog("[AuroraPlayer] play requested but no current item")
            return
        }
        switch item.status {
        case .readyToPlay:
            applyPendingSeekAndMaybePlay()
        case .failed:
            NSLog(
                "[AuroraPlayer] item failed: %@",
                item.error?.localizedDescription ?? "unknown"
            )
            // Retry once from disk — helps after empty→nonempty live writes.
            if !loadedFilePath.isEmpty {
                replaceItem(preservingTime: pendingSeekSeconds ?? currentTime(), andPlay: wantsPlaying)
            }
        case .unknown:
            // Status observer will call playIfReady when ready.
            break
        @unknown default:
            break
        }
    }

    private func applyPendingSeekAndMaybePlay() {
        activateSession()
        if let seekTo = pendingSeekSeconds, seekTo > 0.05 {
            pendingSeekSeconds = nil
            let t = CMTime(seconds: seekTo, preferredTimescale: 1_000)
            player?.seek(to: t, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
                guard let self, finished else { return }
                if self.wantsPlaying {
                    self.player?.play()
                }
                self.updateNowPlaying(elapsed: seekTo)
            }
        } else if wantsPlaying {
            player?.play()
            updateNowPlaying(elapsed: currentTime())
        }
    }

    // MARK: — Observers

    private func attachObservers(to item: AVPlayerItem) {
        statusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard let self else { return }
            switch item.status {
            case .readyToPlay:
                if self.metaDuration <= 0, item.duration.isNumeric {
                    let d = item.duration.seconds
                    if d.isFinite, d > 0 {
                        self.metaDuration = d
                        rustPlayerCallback(eventType: 8, value: d)
                    }
                }
                if self.wantsPlaying || self.pendingSeekSeconds != nil {
                    self.playIfReady()
                } else {
                    self.updateNowPlaying(elapsed: self.currentTime())
                }
            case .failed:
                NSLog(
                    "[AuroraPlayer] AVPlayerItem failed: %@",
                    item.error?.localizedDescription ?? "unknown"
                )
            case .unknown:
                break
            @unknown default:
                break
            }
        }

        let interval = CMTime(seconds: 0.5, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            guard self.player?.timeControlStatus == .playing else { return }
            let seconds = time.seconds
            guard seconds.isFinite else { return }
            rustPlayerCallback(eventType: 6, value: seconds)
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            if self.expectsMoreContent {
                self.waitingForMoreContent = self.wantsPlaying
                self.player?.pause()
                self.updateNowPlaying(elapsed: self.currentTime())
                // Keep wantsPlaying true so file-extension resume continues.
                rustPlayerCallback(eventType: 2, value: 0)
            } else {
                self.wantsPlaying = false
                self.waitingForMoreContent = false
                self.updateNowPlaying(elapsed: self.currentTime())
                rustPlayerCallback(eventType: 7, value: 0)
            }
        }
    }

    private func tearDownItemObservers() {
        statusObserver?.invalidate()
        statusObserver = nil
        if let obs = timeObserver {
            player?.removeTimeObserver(obs)
            timeObserver = nil
        }
        if let obs = endObserver {
            NotificationCenter.default.removeObserver(obs)
            endObserver = nil
        }
    }

    private func tearDownObservers() {
        tearDownItemObservers()
    }

    // MARK: — Now Playing

    private func updateNowPlaying(elapsed: Double) {
        let rate: Double
        if player?.timeControlStatus == .playing {
            rate = Double(player?.rate ?? 1)
        } else {
            rate = 0
        }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: metaTitle,
            MPMediaItemPropertyArtist: metaArtist,
            MPMediaItemPropertyPlaybackDuration: metaDuration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if let coverArtwork {
            info[MPMediaItemPropertyArtwork] = coverArtwork
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

// ─── C-callable exports (called by Rust via `extern "C"`) ─────────────────────

@_cdecl("aurora_player_load")
public func auroraPlayerLoad(
    filePath: UnsafePointer<CChar>,
    title: UnsafePointer<CChar>,
    artist: UnsafePointer<CChar>,
    duration: Double,
    expectsMore: Bool,
    coverPath: UnsafePointer<CChar>
) {
    let fp = String(cString: filePath)
    let t = String(cString: title)
    let a = String(cString: artist)
    let cover = String(cString: coverPath)
    // Run on main synchronously so Rust `ios_player_load` returns only after
    // the item is attached (play can then safely follow in the next invoke).
    let work = {
        AuroraPlayer.shared.load(
            filePath: fp,
            title: t,
            artist: a,
            duration: duration,
            expectsMore: expectsMore,
            coverPath: cover
        )
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_notify_file_extended")
public func auroraPlayerNotifyFileExtended(duration: Double) {
    let work = {
        AuroraPlayer.shared.notifyFileExtended(duration: duration)
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_set_expects_more")
public func auroraPlayerSetExpectsMore(_ expectsMore: Bool) {
    let work = {
        AuroraPlayer.shared.setExpectsMoreContent(expectsMore)
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_play")
public func auroraPlayerPlay() {
    let work = {
        AuroraPlayer.shared.play()
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_pause")
public func auroraPlayerPause() {
    let work = {
        AuroraPlayer.shared.pause()
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_seek")
public func auroraPlayerSeek(seconds: Double) {
    let work = {
        AuroraPlayer.shared.seek(to: seconds)
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_set_rate")
public func auroraPlayerSetRate(rate: Float) {
    let work = {
        AuroraPlayer.shared.setRate(rate)
    }
    if Thread.isMainThread {
        work()
    } else {
        DispatchQueue.main.sync(execute: work)
    }
}

@_cdecl("aurora_player_current_time")
public func auroraPlayerCurrentTime() -> Double {
    return AuroraPlayer.shared.currentTime()
}

@_cdecl("aurora_player_is_playing")
public func auroraPlayerIsPlaying() -> Bool {
    return AuroraPlayer.shared.isPlaying()
}
