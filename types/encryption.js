var iv = new Uint8Array([188, 185, 57, 146, 246, 194, 116, 34, 12, 80, 198, 76]);
var textEnc = new TextEncoder();
var textDec = new TextDecoder("utf-8");

/**
 * Encryption functionality using SubtleCrypto algorithm
 */

export const importKey = () => {
    return window.crypto.subtle.importKey(
        "jwk", //can be "jwk" or "raw"
        {   //this is an example jwk key, "raw" would be an ArrayBuffer
            kty: "oct",
            k: "Y0zt37HgOx-BY7SQjYVmrqhPkO44Ii2Jcb9yydUDPfE",
            alg: "A256GCM",
            ext: true,
        },
        {   //this is the algorithm options
            name: "AES-GCM",
        },
        false, //whether the key is extractable (i.e. can be used in exportKey)
        ["encrypt", "decrypt"] //can "encrypt", "decrypt", "wrapKey", or "unwrapKey"
    )
}

export const generateKey = () => {
    return window.crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256, //can be  128, 192, or 256
        },
        true, //whether the key is extractable (i.e. can be used in exportKey)
        ["encrypt", "decrypt"] //can "encrypt", "decrypt", "wrapKey", or "unwrapKey"
    )
}

export const encrypt = (data, key, iv) => {
    return window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",

            //Don't re-use initialization vectors!
            //Always generate a new iv every time your encrypt!
            //Recommended to use 12 bytes length
            iv: iv,

            //Additional authentication data (optional)
            // additionalData: ArrayBuffer,

            //Tag length (optional)
            tagLength: 128, //can be 32, 64, 96, 104, 112, 120 or 128 (default)
        },
        key, //from generateKey or importKey above
        data //ArrayBuffer of data you want to encrypt
    );
}

export const decrypt = (data, key, iv) => {
    return window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv, //The initialization vector you used to encrypt
            //additionalData: ArrayBuffer, //The addtionalData you used to encrypt (if any)
            tagLength: 128, //The tagLength you used to encrypt (if any)
        },
        key, //from generateKey or importKey above
        data //ArrayBuffer of the data
    )
}

export const encryptToString = async (data) => {
    data = textEnc.encode(data);
    let key = await importKey();
    let result = new Uint8Array(await encrypt(data, key, iv));
    let res = '';
    for (let i = 0; i < result.length; i++)
        res += String.fromCharCode(result[i]);

    return res;
}

export const decryptFromString = async (data) => {
    let key = await importKey();
    let buffer = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
        buffer[i] = data.charCodeAt(i);
    }

    return textDec.decode(await decrypt(buffer, key, iv));
}