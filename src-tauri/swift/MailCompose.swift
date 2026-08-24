// MailCompose.swift
// Compose an email with a file attachment (iOS MessageUI).
// Falls back to the share sheet when Mail is not configured.

import Foundation
import MessageUI
import UIKit

private enum MailComposeError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let s): return s
        }
    }
}

private final class MailComposeDelegate: NSObject, MFMailComposeViewControllerDelegate {
    static var active: MailComposeDelegate?
    private let done: DispatchSemaphore

    init(done: DispatchSemaphore) {
        self.done = done
    }

    func mailComposeController(
        _ controller: MFMailComposeViewController,
        didFinishWith result: MFMailComposeResult,
        error: Error?
    ) {
        controller.dismiss(animated: true) {
            MailComposeDelegate.active = nil
            self.done.signal()
        }
    }
}

private final class MailCompose {
    static let shared = MailCompose()
    static var lastErrorMessage: String = ""

    func compose(
        to: String,
        subject: String,
        body: String,
        attachmentPath: String
    ) throws {
        Self.lastErrorMessage = ""
        let attachmentURL = URL(fileURLWithPath: attachmentPath)
        guard FileManager.default.fileExists(atPath: attachmentPath) else {
            throw MailComposeError.message("Attachment missing: \(attachmentPath)")
        }

        if MFMailComposeViewController.canSendMail() {
            try presentMailComposer(
                to: to,
                subject: subject,
                body: body,
                attachmentURL: attachmentURL
            )
            return
        }

        // No Mail accounts — let the user pick Mail / Files / AirDrop.
        try ShareExportBridge.share(filePath: attachmentPath)
    }

    private func presentMailComposer(
        to: String,
        subject: String,
        body: String,
        attachmentURL: URL
    ) throws {
        var presentError: Error?
        let done = DispatchSemaphore(value: 0)

        DispatchQueue.main.async {
            guard let root = Self.topViewController() else {
                presentError = MailComposeError.message("No root view controller for mail composer")
                done.signal()
                return
            }

            let composer = MFMailComposeViewController()
            let delegate = MailComposeDelegate(done: done)
            MailComposeDelegate.active = delegate
            composer.mailComposeDelegate = delegate
            composer.setToRecipients([to])
            composer.setSubject(subject)
            composer.setMessageBody(body, isHTML: false)

            if let data = try? Data(contentsOf: attachmentURL) {
                composer.addAttachmentData(
                    data,
                    mimeType: "text/plain",
                    fileName: attachmentURL.lastPathComponent
                )
            } else {
                presentError = MailComposeError.message(
                    "Failed to read attachment: \(attachmentURL.path)"
                )
                MailComposeDelegate.active = nil
                done.signal()
                return
            }

            root.present(composer, animated: true)
        }

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

/// Call into ShareExport's C ABI when Mail is unavailable.
@_silgen_name("aurora_share_file")
private func aurora_share_file(_ filePath: UnsafePointer<CChar>) -> Int32

private enum ShareExportBridge {
    static func share(filePath: String) throws {
        var shareError: Error?
        filePath.withCString { cPath in
            if aurora_share_file(cPath) != 0 {
                shareError = MailComposeError.message("Share sheet failed")
            }
        }
        if let shareError {
            throw shareError
        }
    }
}

@_cdecl("aurora_compose_mail_with_attachment")
public func auroraComposeMailWithAttachment(
    to: UnsafePointer<CChar>,
    subject: UnsafePointer<CChar>,
    body: UnsafePointer<CChar>,
    attachmentPath: UnsafePointer<CChar>
) -> Int32 {
    do {
        try MailCompose.shared.compose(
            to: String(cString: to),
            subject: String(cString: subject),
            body: String(cString: body),
            attachmentPath: String(cString: attachmentPath)
        )
        return 0
    } catch {
        MailCompose.lastErrorMessage = error.localizedDescription
        NSLog("[MailCompose] %@", error.localizedDescription)
        return 1
    }
}

@_cdecl("aurora_compose_mail_last_error")
public func auroraComposeMailLastError() -> UnsafeMutablePointer<CChar>? {
    let msg = MailCompose.lastErrorMessage
    guard !msg.isEmpty else { return nil }
    return strdup(msg)
}

@_cdecl("aurora_compose_mail_free_string")
public func auroraComposeMailFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}
