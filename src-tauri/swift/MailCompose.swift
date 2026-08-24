// MailCompose.swift
// Open a bug-report email with a file attachment on iOS.
//
// 1) Apple Mail configured → MFMailComposeViewController (in-app, full draft).
// 2) Otherwise → write a .eml draft and present a mail-oriented share sheet so
//    the user can open Mail / Gmail / Outlook with the attachment (sharing a
//    raw .txt makes iOS push "Save to Files" first).

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

/// Provides subject (and placeholder) so the share sheet favors mail apps.
private final class MailDraftItemSource: NSObject, UIActivityItemSource {
    let fileURL: URL
    let subject: String

    init(fileURL: URL, subject: String) {
        self.fileURL = fileURL
        self.subject = subject
    }

    func activityViewControllerPlaceholderItem(
        _ activityViewController: UIActivityViewController
    ) -> Any {
        fileURL
    }

    func activityViewController(
        _ activityViewController: UIActivityViewController,
        itemForActivityType activityType: UIActivity.ActivityType?
    ) -> Any? {
        fileURL
    }

    func activityViewController(
        _ activityViewController: UIActivityViewController,
        subjectForActivityType activityType: UIActivity.ActivityType?
    ) -> String {
        subject
    }

    func activityViewController(
        _ activityViewController: UIActivityViewController,
        dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?
    ) -> String {
        "public.email-message"
    }
}

private final class MailCompose {
    static let shared = MailCompose()
    static var lastErrorMessage: String = ""
    /// Keep the item source alive while the share sheet is visible.
    private var activeShareSource: MailDraftItemSource?

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
            NSLog("[MailCompose] Presenting MFMailComposeViewController")
            try presentMailComposer(
                to: to,
                subject: subject,
                body: body,
                attachmentURL: attachmentURL
            )
            return
        }

        // No Apple Mail account — share a complete .eml draft (not the raw .txt).
        NSLog("[MailCompose] canSendMail=false; sharing .eml draft")
        let emlURL = try writeEmlDraft(
            to: to,
            subject: subject,
            body: body,
            attachmentURL: attachmentURL
        )
        try presentMailShareSheet(emlURL: emlURL, subject: subject)
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

            let data: Data
            do {
                data = try Data(contentsOf: attachmentURL)
            } catch {
                presentError = MailComposeError.message(
                    "Failed to read attachment: \(attachmentURL.path)"
                )
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
            composer.addAttachmentData(
                data,
                mimeType: "text/plain",
                fileName: attachmentURL.lastPathComponent
            )
            root.present(composer, animated: true)
        }

        done.wait()
        if let presentError {
            throw presentError
        }
    }

    private func presentMailShareSheet(emlURL: URL, subject: String) throws {
        var presentError: Error?
        let done = DispatchSemaphore(value: 0)
        let source = MailDraftItemSource(fileURL: emlURL, subject: subject)
        activeShareSource = source

        DispatchQueue.main.async {
            guard let root = Self.topViewController() else {
                presentError = MailComposeError.message("No root view controller for mail share")
                self.activeShareSource = nil
                done.signal()
                return
            }

            let activity = UIActivityViewController(
                activityItems: [source],
                applicationActivities: nil
            )
            // Hide actions that make this feel like a file-save flow.
            activity.excludedActivityTypes = [
                .addToReadingList,
                .assignToContact,
                .print,
                .markupAsPDF,
                .openInIBooks,
                .postToFacebook,
                .postToTwitter,
                .postToWeibo,
                .postToTencentWeibo,
                .postToVimeo,
                .postToFlickr,
                .saveToCameraRoll,
            ]
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
                self.activeShareSource = nil
                done.signal()
            }
            root.present(activity, animated: true)
        }

        done.wait()
        if let presentError {
            throw presentError
        }
    }

    private func writeEmlDraft(
        to: String,
        subject: String,
        body: String,
        attachmentURL: URL
    ) throws -> URL {
        let attachmentData = try Data(contentsOf: attachmentURL)
        let attachmentName = attachmentURL.lastPathComponent
        let boundary = "AuroraBookBoundary\(Int(Date().timeIntervalSince1970))"
        let encoded = attachmentData.base64EncodedString(options: [
            .lineLength76Characters,
            .endLineWithCarriageReturn,
        ])

        let safeSubject = Self.headerSafe(subject)
        let safeTo = Self.headerSafe(to)
        // Build without indented multiline literals — leading spaces break RFC822 headers.
        var eml = ""
        eml += "MIME-Version: 1.0\r\n"
        eml += "To: \(safeTo)\r\n"
        eml += "Subject: \(safeSubject)\r\n"
        eml += "Content-Type: multipart/mixed; boundary=\"\(boundary)\"\r\n"
        eml += "\r\n"
        eml += "--\(boundary)\r\n"
        eml += "Content-Type: text/plain; charset=utf-8\r\n"
        eml += "Content-Transfer-Encoding: 8bit\r\n"
        eml += "\r\n"
        eml += "\(body)\r\n"
        eml += "\r\n"
        eml += "--\(boundary)\r\n"
        eml += "Content-Type: text/plain; charset=utf-8; name=\"\(attachmentName)\"\r\n"
        eml += "Content-Disposition: attachment; filename=\"\(attachmentName)\"\r\n"
        eml += "Content-Transfer-Encoding: base64\r\n"
        eml += "\r\n"
        eml += "\(encoded)\r\n"
        eml += "--\(boundary)--\r\n"

        let emlURL = attachmentURL
            .deletingLastPathComponent()
            .appendingPathComponent("aurorabook-bug-report.eml")
        guard let emlData = eml.data(using: .utf8) else {
            throw MailComposeError.message("Failed to encode .eml draft")
        }
        try emlData.write(to: emlURL, options: .atomic)
        return emlURL
    }

    private static func headerSafe(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
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
