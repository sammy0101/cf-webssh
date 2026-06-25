// 堆疊安全的 ArrayBuffer 轉 Base64 函數 (防範大檔案私鑰溢位)
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 堆疊安全的 Base64 轉 ArrayBuffer 函數
export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// 根據管理密碼衍生對稱加密金鑰 (AES-GCM 256-bit)
export async function deriveKey(adminPassword) {
  const passwordBytes = new TextEncoder().encode(adminPassword);
  const hash = await crypto.subtle.digest('SHA-256', passwordBytes);
  return await crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// 加密明文字串
export async function encryptText(text, key) {
  if (text === undefined || text === null) return '';
  const str = String(text);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV 適用於 GCM
  const encoded = new TextEncoder().encode(str);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const ivB64 = arrayBufferToBase64(iv);
  const cipherB64 = arrayBufferToBase64(ciphertext);
  return `${ivB64}:${cipherB64}`;
}

// 解密字串 (支援對舊明文數值/字串的向下相容)
export async function decryptText(encryptedStr, key) {
  if (encryptedStr === undefined || encryptedStr === null) return '';
  const str = String(encryptedStr);
  const parts = str.split(':');
  if (parts.length !== 2) {
    return str;
  }
  try {
    const [ivB64, cipherB64] = parts;
    const iv = new Uint8Array(base64ToArrayBuffer(ivB64));
    const ciphertext = base64ToArrayBuffer(cipherB64);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("安全解密失敗:", err);
    throw new Error("憑據解密失敗。");
  }
}

// 使用 WebCrypto 計算 SHA-256 雜湊值（用於登入 Session Token 簽章）
export async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 根據環境變數中的密碼加鹽計算預期 Token
export async function getExpectedToken(adminPassword) {
  return await hashPassword(adminPassword + "cf-webssh-salt-2026");
}
