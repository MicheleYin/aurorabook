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
///   6 timeUpdate(value=seconds) · 7 ended
@_silgen_name("on_native_player_event")
private func rustPlayerCallback(eventType: UInt8, value: Double)

// ─── Player singleton ─────────────────────────────────────────────────────────

private final class AuroraPlayer: NSObject {
    static let shared = AuroraPlayer()

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    // Metadata for MPNowPlayingInfoCenter
    private var metaTitle = ""
    private var metaArtist = ""
    private var metaDuration: Double = 0

    private override init() {
        super.init()
        configureAudioSession()
        registerRemoteCommands()
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

    func load(filePath: String, title: String, artist: String, duration: Double) {
        // Tear down previous observers
        tearDownObservers()

        metaTitle = title
        metaArtist = artist
        metaDuration = duration

        let url = URL(fileURLWithPath: filePath)
        let item = AVPlayerItem(url: url)

        if player == nil {
            player = AVPlayer(playerItem: item)
            player?.automaticallyWaitsToMinimizeStalling = false
        } else {
            player?.replaceCurrentItem(with: item)
        }

        attachObservers(to: item)
        updateNowPlaying(elapsed: 0)
    }

    // MARK: — Controls

    func play() {
        player?.play()
        updateNowPlaying(elapsed: currentTime())
    }

    func pause() {
        player?.pause()
        updateNowPlaying(elapsed: currentTime())
    }

    func seek(to seconds: Double) {
        let t = CMTime(seconds: seconds, preferredTimescale: 1_000)
        player?.seek(to: t, toleranceBefore: .zero, toleranceAfter: .zero)
        updateNowPlaying(elapsed: seconds)
    }

    func setRate(_ rate: Float) {
        if rate == 0 {
            player?.pause()
        } else {
            player?.rate = rate
        }
        updateNowPlaying(elapsed: currentTime())
    }

    func currentTime() -> Double {
        return player?.currentTime().seconds ?? 0
    }

    func isPlaying() -> Bool {
        return player?.timeControlStatus == .playing
    }

    // MARK: — Observers

    private func attachObservers(to item: AVPlayerItem) {
        // 1-second periodic tick for frontend time-sync
        let interval = CMTime(seconds: 1, preferredTimescale: CMTimeScale(NSEC_PER_SEC))
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard self?.player?.timeControlStatus == .playing else { return }
            rustPlayerCallback(eventType: 6, value: time.seconds)
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { _ in
            rustPlayerCallback(eventType: 7, value: 0)
        }
    }

    private func tearDownObservers() {
        if let obs = timeObserver {
            player?.removeTimeObserver(obs)
            timeObserver = nil
        }
        if let obs = endObserver {
            NotificationCenter.default.removeObserver(obs)
            endObserver = nil
        }
    }

    // MARK: — Now Playing

    private func updateNowPlaying(elapsed: Double) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: metaTitle,
            MPMediaItemPropertyArtist: metaArtist,
            MPMediaItemPropertyPlaybackDuration: metaDuration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: Double(player?.rate ?? 0),
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
    }
}

// ─── C-callable exports (called by Rust via `extern "C"`) ─────────────────────

@_cdecl("aurora_player_load")
public func auroraPlayerLoad(
    filePath: UnsafePointer<CChar>,
    title: UnsafePointer<CChar>,
    artist: UnsafePointer<CChar>,
    duration: Double
) {
    let fp = String(cString: filePath)
    let t  = String(cString: title)
    let a  = String(cString: artist)
    DispatchQueue.main.async {
        AuroraPlayer.shared.load(filePath: fp, title: t, artist: a, duration: duration)
    }
}

@_cdecl("aurora_player_play")
public func auroraPlayerPlay() {
    DispatchQueue.main.async { AuroraPlayer.shared.play() }
}

@_cdecl("aurora_player_pause")
public func auroraPlayerPause() {
    DispatchQueue.main.async { AuroraPlayer.shared.pause() }
}

@_cdecl("aurora_player_seek")
public func auroraPlayerSeek(seconds: Double) {
    DispatchQueue.main.async { AuroraPlayer.shared.seek(to: seconds) }
}

@_cdecl("aurora_player_set_rate")
public func auroraPlayerSetRate(rate: Float) {
    DispatchQueue.main.async { AuroraPlayer.shared.setRate(rate) }
}

@_cdecl("aurora_player_current_time")
public func auroraPlayerCurrentTime() -> Double {
    return AuroraPlayer.shared.currentTime()
}

@_cdecl("aurora_player_is_playing")
public func auroraPlayerIsPlaying() -> Bool {
    return AuroraPlayer.shared.isPlaying()
}
