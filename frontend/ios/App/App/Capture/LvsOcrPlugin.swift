// LvsOcr for iOS: on-device text recognition with Apple Vision for screenshot import.
// The image arrives as base64, is recognised in memory and dropped; it is never written to disk
// or uploaded, and recognised text is never logged.
//
// COMPILE-UNTESTED (written without a Mac). Not yet part of the Xcode target; see
// docs/mobile-capture.md "iOS setup" for the three steps that wire it in.
//
// JS: recognize({ base64 }) -> { width, height, blocks: [{ text, lines: [{ text, x, y, w, h }] }] }
// Coordinates are pixels, origin top-left (Vision's normalised bottom-left boxes are converted).

import Capacitor
import Foundation
import UIKit
import Vision

@objc(LvsOcrPlugin)
public class LvsOcrPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LvsOcrPlugin"
    public let jsName = "LvsOcr"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cg = LvsOcrPlugin.uprightCGImage(image) else {
            call.reject("Unsupported image")
            return
        }
        let width = cg.width
        let height = cg.height

        let request = VNRecognizeTextRequest { req, err in
            if err != nil {
                call.reject("Text recognition failed")
                return
            }
            let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
            var lines: [[String: Any]] = []
            for o in observations {
                guard let best = o.topCandidates(1).first else { continue }
                let bb = o.boundingBox // normalised, origin bottom-left
                lines.append([
                    "text": best.string,
                    "x": Int((bb.minX * CGFloat(width)).rounded()),
                    "y": Int(((1 - bb.maxY) * CGFloat(height)).rounded()),
                    "w": Int((bb.width * CGFloat(width)).rounded()),
                    "h": Int((bb.height * CGFloat(height)).rounded())
                ])
            }
            // Vision returns lines, not blocks: one block keeps the shape Android returns.
            call.resolve([
                "width": width,
                "height": height,
                "blocks": [["text": "", "lines": lines]]
            ])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                call.reject("Text recognition failed")
            }
        }
    }

    /// Screenshots are already upright; photos may carry an EXIF orientation, so redraw those.
    private static func uprightCGImage(_ image: UIImage) -> CGImage? {
        if image.imageOrientation == .up { return image.cgImage }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
        let upright = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
        return upright.cgImage
    }
}
