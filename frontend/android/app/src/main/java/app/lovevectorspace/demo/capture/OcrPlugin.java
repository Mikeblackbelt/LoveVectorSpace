package app.lovevectorspace.demo.capture;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * LvsOcr: on-device text recognition for screenshot import, with Google ML Kit's bundled
 * Latin model. The image arrives as base64, is decoded in memory, recognised, and dropped:
 * it is never written to disk or sent anywhere. Recognised text is never logged.
 *
 * JS: recognize({ base64 }) -> { width, height, blocks: [{ text, lines: [{ text, x, y, w, h }] }] }
 * Coordinates are pixels of the (possibly downscaled) bitmap described by width/height.
 */
@CapacitorPlugin(name = "LvsOcr")
public class OcrPlugin extends Plugin {

    private static final int MAX_SIDE = 3200;
    private TextRecognizer recognizer;

    @Override
    public void load() {
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null || b64.isEmpty()) {
            call.reject("base64 is required");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid image data");
            return;
        }
        final Bitmap bmp = decodeScaled(bytes);
        if (bmp == null) {
            call.reject("Unsupported image");
            return;
        }
        InputImage image = InputImage.fromBitmap(bmp, 0);
        recognizer
            .process(image)
            .addOnSuccessListener(text -> {
                JSObject ret = new JSObject();
                ret.put("width", bmp.getWidth());
                ret.put("height", bmp.getHeight());
                JSArray blocks = new JSArray();
                for (Text.TextBlock b : text.getTextBlocks()) {
                    JSObject jb = new JSObject();
                    jb.put("text", b.getText());
                    JSArray lines = new JSArray();
                    for (Text.Line l : b.getLines()) {
                        Rect r = l.getBoundingBox();
                        if (r == null) continue;
                        JSObject jl = new JSObject();
                        jl.put("text", l.getText());
                        jl.put("x", r.left);
                        jl.put("y", r.top);
                        jl.put("w", r.width());
                        jl.put("h", r.height());
                        lines.put(jl);
                    }
                    jb.put("lines", lines);
                    blocks.put(jb);
                }
                ret.put("blocks", blocks);
                bmp.recycle();
                call.resolve(ret);
            })
            .addOnFailureListener(e -> {
                bmp.recycle();
                call.reject("Text recognition failed");
            });
    }

    /** Decode, downsampling very large images so recognition stays fast and memory-safe. */
    private static Bitmap decodeScaled(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    @Override
    protected void handleOnDestroy() {
        if (recognizer != null) recognizer.close();
        super.handleOnDestroy();
    }
}
