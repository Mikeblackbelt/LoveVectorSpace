package app.lovevectorspace.demo.capture;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * AES-256-GCM with a non-exportable key in the Android Keystore. Used for the capture state
 * file (linked contacts, queue, seen-hashes). Blob layout: [version=1][12-byte IV][ciphertext+tag].
 */
final class CryptoBox {

    private static final String ALIAS = "lvs_capture_v1";
    private static final String STORE = "AndroidKeyStore";
    private static final byte VERSION = 1;

    private CryptoBox() {}

    private static SecretKey key() throws GeneralSecurityException, java.io.IOException {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        kg.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return kg.generateKey();
    }

    static byte[] encrypt(byte[] plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain);
        byte[] out = new byte[1 + iv.length + ct.length];
        out[0] = VERSION;
        System.arraycopy(iv, 0, out, 1, iv.length);
        System.arraycopy(ct, 0, out, 1 + iv.length, ct.length);
        return out;
    }

    static byte[] decrypt(byte[] blob) throws Exception {
        if (blob.length < 1 + 12 + 16 || blob[0] != VERSION) throw new GeneralSecurityException("bad blob");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, blob, 1, 12));
        return c.doFinal(blob, 13, blob.length - 13);
    }
}
