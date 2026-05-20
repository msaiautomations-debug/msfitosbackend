const crypto = require('crypto');
const ALGORITHM = 'aes-256-cbc';
const SECRET = process.env.AES_SECRET || 'default_change_me_32_bytes_long123';

function _getKey() {
  return crypto.createHash('sha256').update(String(SECRET)).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, _getKey(), iv);
  let encrypted = cipher.update(String(text), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(token) {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 2) return null;
  const iv = Buffer.from(parts[0], 'base64');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, _getKey(), iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
