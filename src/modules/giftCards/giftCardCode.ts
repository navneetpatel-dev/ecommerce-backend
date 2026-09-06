import crypto from 'crypto';

/** Crockford-style alphabet — no 0/O/1/I, avoids visual ambiguity when read aloud or typed. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

/** Cryptographically random, unguessable redeem code (~61 bits of entropy). */
export function generateGiftCardCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}
