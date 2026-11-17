/**
 * Automated safety and content screening filter for User Generated Content (UGC).
 *
 * Screens for:
 * 1. PII: Phone numbers (domestic & international, formatted or spaced) and email addresses.
 * 2. Spam & External Links: URLs, web addresses, domain names.
 * 3. Off-platform transaction solicitations (e.g. WhatsApp, direct payment).
 * 4. Profanity & Abusive Language: Curated list of abusive terms with leetspeak normalization.
 */

export type ContentFlag = 'PROFANITY' | 'PII_PHONE' | 'PII_EMAIL' | 'EXTERNAL_LINK' | 'OFF_PLATFORM_SOLICITATION';

export interface ContentFilterResult {
  isClean: boolean;
  flags: ContentFlag[];
  reasons: string[];
}

// 1. PII: Phone regex patterns
// Catches: +91 9876543210, 09876543210, 9876543210, 98765-43210, 98765 43210, 9.8.7.6.5.4.3.2.1.0
const PHONE_PATTERNS = [
  // Standard formatted with country code: +91-9876543210, +1 (555) 123-4567
  /(?:\+|00)\d{1,4}[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?){1,4}\d{1,4}/,
  // 10-digit mobile starting with 6, 7, 8, 9 (India specific) with optional separators
  /\b[6-9]\d{4}[-.\s]?\d{5}\b/,
  /\b[6-9](?:[-.\s]?\d){9}\b/,
  // Common spaced-out or segmented numbers (e.g. "call 9 8 7 6 5 4 3 2 1 0")
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
];

// 2. PII: Email patterns (including basic obfuscation like name[at]domain[dot]com)
const EMAIL_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i,
  /[a-zA-Z0-9._%+-]+\s*(?:\[at\]|\(at\)|@)\s*[a-zA-Z0-9.-]+\s*(?:\[dot\]|\(dot\)|\.)\s*[a-zA-Z]{2,}/i,
];

// 3. URLs & External Links
const LINK_PATTERNS = [
  /https?:\/\/[^\s]+/i,
  /www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*/i,
  /\b[a-zA-Z0-9-]+\.(?:com|in|org|net|co|io|xyz|info|biz|me|app|store|online|site|tech|shop)(?:\/[^\s]*)?/i,
];

// 4. Off-platform transaction keywords
const SOLICITATION_PATTERNS = [
  /\b(?:call|contact|message|reach|ping|whatsapp|dm)\s+(?:me|us)?\s*(?:on|at)?\s*(?:whatsapp|wa|insta|instagram|telegram|tg|phone|mobile|cell)\b/i,
  /\bwa\.me\/\S+/i,
  /\b(?:pay|send money|transfer)\s+(?:via|through|on|to)?\s*(?:gpay|google pay|phonepe|paytm|upi|outside|bank account)\b/i,
];

// 5. Profanity & Abusive Blocklist
// Word-boundary matched to prevent false positives on benign words like "classic", "grape", "hello".
const PROFANITY_BLOCKLIST = [
  // Common English profanities
  'fuck',
  'fucking',
  'fucked',
  'fucker',
  'fucks',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'bitching',
  'asshole',
  'assholes',
  'bastard',
  'bastards',
  'dick',
  'dicks',
  'pussy',
  'cunt',
  'cunts',
  'slut',
  'whore',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  // Common Indian/colloquial abusive terms & slurs
  'chutiya',
  'chutiye',
  'chutya',
  'madarchod',
  'mc',
  'bhenchod',
  'behenchod',
  'bc',
  'gandu',
  'bhosdike',
  'bhosadike',
  'bsdk',
  'harami',
  'kutta',
  'kamine',
  'kamina',
  'randi',
  'saala',
  'suar',
  'lauda',
  'loda',
  'lavda',
];

// Common masked / asterisk profanity patterns (e.g. f*ck, b*tch, sh*t)
const MASKED_PROFANITY_PATTERNS = [
  /\bf[\*_u@#0-9]+ck\b/i,
  /\bsh[\*_i!#0-9]+t\b/i,
  /\bb[\*_i!#0-9]+tch\b/i,
  /\ba[\*_\$@#0-9]+ss(?:hole)?\b/i,
  /\bd[\*_i!#0-9]+ck\b/i,
  /\bp[\*_u@#0-9]+ssy\b/i,
  /\bc[\*_u@#0-9]+nt\b/i,
];

/**
 * Normalizes leetspeak and special substitutions to plain text before checking.
 * e.g., f*ck -> fuck, b!tch -> bitch, @ss -> ass
 */
function normalizeLeetspeak(text: string): string {
  return text
    .replace(/[@]/g, 'a')
    .replace(/[$]/g, 's')
    .replace(/[!|1]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[*_]/g, '');
}

/**
 * Screens user-generated text for safety violations.
 * Returns whether the content is clean along with detected flags and explanatory reasons.
 */
export function screenContent(text: string | null | undefined): ContentFilterResult {
  if (!text || !text.trim()) {
    return { isClean: true, flags: [], reasons: [] };
  }

  const raw = text.trim();
  const flags: ContentFlag[] = [];
  const reasons: string[] = [];

  // Check 1: Phone numbers
  for (const pattern of PHONE_PATTERNS) {
    if (pattern.test(raw)) {
      flags.push('PII_PHONE');
      reasons.push('Contains phone number or personal contact details');
      break;
    }
  }

  // Check 2: Email addresses
  for (const pattern of EMAIL_PATTERNS) {
    if (pattern.test(raw)) {
      flags.push('PII_EMAIL');
      reasons.push('Contains email address');
      break;
    }
  }

  // Check 3: External Links
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(raw)) {
      flags.push('EXTERNAL_LINK');
      reasons.push('Contains external links or web URLs');
      break;
    }
  }

  // Check 4: Off-platform solicitation
  for (const pattern of SOLICITATION_PATTERNS) {
    if (pattern.test(raw)) {
      flags.push('OFF_PLATFORM_SOLICITATION');
      reasons.push('Contains solicitation for off-platform communication or payments');
      break;
    }
  }

  // Check 5: Profanity & Abusive words
  let profanityDetected = false;
  for (const pattern of MASKED_PROFANITY_PATTERNS) {
    if (pattern.test(raw)) {
      flags.push('PROFANITY');
      reasons.push('Contains offensive, abusive, or inappropriate language');
      profanityDetected = true;
      break;
    }
  }

  if (!profanityDetected) {
    const normalized = normalizeLeetspeak(raw.toLowerCase());
    for (const word of PROFANITY_BLOCKLIST) {
      // Exact word boundary check
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(raw) || regex.test(normalized)) {
        flags.push('PROFANITY');
        reasons.push('Contains offensive, abusive, or inappropriate language');
        break;
      }
    }
  }

  return {
    isClean: flags.length === 0,
    flags,
    reasons,
  };
}
