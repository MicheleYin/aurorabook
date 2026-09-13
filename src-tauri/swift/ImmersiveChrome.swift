// ImmersiveChrome.swift
// Dynamically hide/show the iOS status bar + home indicator via Tao's
// UIViewController setters (setPrefersStatusBarHidden: /
// setPrefersHomeIndicatorAutoHidden:). Do not set UIStatusBarHidden in
// Info.plist if you want this toggle to work at runtime.

import Foundation
import UIKit

private func auroraRootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let window = scenes
        .flatMap(\.windows)
        .first(where: \.isKeyWindow) ?? scenes.first?.windows.first
    return window?.rootViewController
}

private func auroraCallBoolSetter(_ object: NSObject, _ name: String, _ value: Bool) {
    let sel = NSSelectorFromString(name)
    guard object.responds(to: sel) else { return }
    typealias Fn = @convention(c) (AnyObject, Selector, Bool) -> Void
    let imp = object.method(for: sel)
    let fn = unsafeBitCast(imp, to: Fn.self)
    fn(object, sel, value)
}

/// `hidden == true` → immersive (status bar + home indicator auto-hidden).
@_cdecl("aurora_set_immersive_chrome")
public func auroraSetImmersiveChrome(_ hidden: Bool) {
    let apply = {
        guard let vc = auroraRootViewController() else { return }
        auroraCallBoolSetter(vc, "setPrefersStatusBarHidden:", hidden)
        auroraCallBoolSetter(vc, "setPrefersHomeIndicatorAutoHidden:", hidden)
    }
    if Thread.isMainThread {
        apply()
    } else {
        DispatchQueue.main.async(execute: apply)
    }
}
