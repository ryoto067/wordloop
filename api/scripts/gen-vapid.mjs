// VAPID 鍵ペアを生成して base64url で表示する: node api/scripts/gen-vapid.mjs
const b64url = (buf) => Buffer.from(buf).toString("base64url");

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = b64url(await crypto.subtle.exportKey("raw", publicKey)); // 65 バイトの非圧縮点
const jwk = await crypto.subtle.exportKey("jwk", privateKey); // d が 32 バイトの秘密スカラー

console.log(`VAPID_PUBLIC_KEY=${pub}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
