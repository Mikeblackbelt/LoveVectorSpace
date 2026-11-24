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

    /// Longest side after downscaling (matches Android's cap): keeps Vision fast and memory-safe.
    private static let maxSide: CGFloat = 3200

    /// Upright and at most `maxSide` on the longest side. Screenshots are usually upright already;
    /// photos may carry an EXIF orientation, and very large images are scaled down.
    private static func uprightCGImage(_ image: UIImage) -> CGImage? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        if image.imageOrientation == .up && scale == 1 { return image.cgImage }
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let upright = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return upright.cgImage
    }
}
