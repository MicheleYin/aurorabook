// ShareExport.swift
// Present the iOS share sheet for a file already written into the app sandbox.
// Used because Files / File Provider save destinations from Tauri's dialog are
// not reliably writable via path strings (security-scoped URL required).

import Foundation
import UIKit

private enum ShareError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let s): return s
        }
    }
}

private final class ShareExport {
    static let shared = ShareExport()
    static var lastErrorMessage: String = ""

    func share(filePath: String) throws {
        Self.lastErrorMessage = ""
        let url = URL(fileURLWithPath: filePath)
        guard FileManager.default.fileExists(atPath: filePath) else {
            throw ShareError.message("Share file missing: \(filePath)")
        }

        var presentError: Error?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.main.async {
            guard let root = Self.topViewController() else {
                presentError = ShareError.message("No root view controller for share sheet")
                done.signal()
                return
            }

            let activity = UIActivityViewController(
                activityItems: [url],
                applicationActivities: nil
            )
            if let pop = activity.popoverPresentationController {
                pop.sourceView = root.view
                pop.sourceRect = CGRect(
                    x: root.view.bounds.midX,
                    y: root.view.bounds.midY,
                    width: 1,
                    height: 1
                )
                pop.permittedArrowDirections = []
            }
            activity.completionWithItemsHandler = { _, _, _, error in
                if let error {
                    presentError = error
                }
                done.signal()
            }
            root.present(activity, animated: true)
        }

        // Wait until the sheet is dismissed (user shared or cancelled).
        done.wait()
        if let presentError {
            throw presentError
        }
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

@_cdecl("aurora_share_file")
public func auroraShareFile(filePath: UnsafePointer<CChar>) -> Int32 {
    let path = String(cString: filePath)
    do {
        try ShareExport.shared.share(filePath: path)
        return 0
    } catch {
        ShareExport.lastErrorMessage = error.localizedDescription
        NSLog("[ShareExport] %@", error.localizedDescription)
        return 1
    }
}

@_cdecl("aurora_share_last_error")
public func auroraShareLastError() -> UnsafeMutablePointer<CChar>? {
    let msg = ShareExport.lastErrorMessage
    guard !msg.isEmpty else { return nil }
    return strdup(msg)
}

@_cdecl("aurora_share_free_string")
public func auroraShareFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
