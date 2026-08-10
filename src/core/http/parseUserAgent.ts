export type ParsedUserAgent = {
  browserName: string;
  osName: string;
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'unknown';
};

/**
 * Lightweight UA parsing without extra dependencies.
 * Good enough for bug-report triage context — not a full browser fingerprint.
 */
export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  const raw = (ua ?? '').trim();
  if (!raw) {
    return { browserName: 'Unknown', osName: 'Unknown', deviceType: 'unknown' };
  }

  const lower = raw.toLowerCase();

  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/ipad|tablet|kindle|playbook|silk|(android(?!.*mobile))/i.test(raw)) {
    deviceType = 'tablet';
  } else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(raw)) {
    deviceType = 'mobile';
  }

  let osName = 'Unknown';
  if (/windows nt/i.test(raw)) osName = 'Windows';
  else if (/android/i.test(raw)) osName = 'Android';
  else if (/iphone|ipad|ipod/i.test(raw)) osName = 'iOS';
  else if (/mac os x|macintosh/i.test(raw)) osName = 'macOS';
  else if (/cros/i.test(raw)) osName = 'Chrome OS';
  else if (/linux/i.test(raw)) osName = 'Linux';

  let browserName = 'Unknown';
  if (/edg\//i.test(raw)) browserName = 'Edge';
  else if (/opr\/|opera/i.test(raw)) browserName = 'Opera';
  else if (/samsungbrowser/i.test(raw)) browserName = 'Samsung Internet';
  else if (/chrome|crios/i.test(raw) && !/edg\//i.test(raw)) browserName = 'Chrome';
  else if (/firefox|fxios/i.test(raw)) browserName = 'Firefox';
  else if (/safari/i.test(raw) && !/chrome|crios|android/i.test(lower)) browserName = 'Safari';
  else if (/msie|trident/i.test(raw)) browserName = 'Internet Explorer';

  return { browserName, osName, deviceType };
}
