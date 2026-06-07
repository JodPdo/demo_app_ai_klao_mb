// lib/token.js — invite token generator (Phase 6.4)
const crypto = require("crypto");

// 31 chars: A-Z minus I/L/O, digits 2-9 minus 0/1
// Read-safe when user retypes from share message.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Generate 8-char invite token using the read-safe alphabet.
 * Example: "X7KD9M2Q"
 * Entropy: 31^8 ≈ 852 billion combinations.
 * Modulo bias is acceptable for V1 (256 % 31 = 8, ~3% bias on some chars).
 */
function generateInviteToken() {
  const bytes = crypto.randomBytes(8);
  let token = "";
  for (let i = 0; i < 8; i++) {
    token += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return token;
}

module.exports = { generateInviteToken, ALPHABET };
