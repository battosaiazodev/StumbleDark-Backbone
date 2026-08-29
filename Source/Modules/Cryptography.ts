import crypto from "crypto";
import { IV, KEY } from "./Constants";

// ─── AES-256-CBC Encryption ───────────────────────────────────────────────────
// يستخدم Node.js crypto مباشرة بدل Web Crypto API لأداء أفضل في بيئة Node

const ALGORITHM = "aes-256-cbc";

function getKeyBuffer(): Buffer {
  // نضمن أن الـ key بالطول الصحيح (32 bytes لـ AES-256)
  return Buffer.from(KEY.padEnd(32, "0").substring(0, 32), "utf8");
}

function getIVBuffer(): Buffer {
  // نضمن أن الـ IV بالطول الصحيح (16 bytes لـ AES-CBC)
  return Buffer.from(IV.padEnd(16, "0").substring(0, 16), "utf8");
}

export function Encrypt(plaintext: string): string {
  try {
    const cipher    = crypto.createCipheriv(ALGORITHM, getKeyBuffer(), getIVBuffer());
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return encrypted.toString("base64");
  } catch (err) {
    throw new Error(`Encryption failed: ${err}`);
  }
}

export function Decrypt(encryptedData: string): string {
  try {
    const data      = Buffer.from(encryptedData, "base64");
    const decipher  = crypto.createDecipheriv(ALGORITHM, getKeyBuffer(), getIVBuffer());
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (err) {
    throw new Error(`Decryption failed: ${err}`);
  }
}

// ─── Hash utilities ───────────────────────────────────────────────────────────

export function HashSHA256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function GenerateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}
