import crypto from 'crypto';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { authRepository as repo } from './auth.repository';
import { authService, type SessionDeviceMeta } from './auth.service';
import { AppError, ForbiddenError, ValidationError } from '@core/errors';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { ROLES, USER_STATUS } from '@core/constants/statuses';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const OAUTH_SCOPES = ['openid', 'email', 'profile'];

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  if (!isGoogleOAuthConfigured()) return null;
  const port = env.PORT;
  const callbackUrl =
    env.GOOGLE_CALLBACK_URL?.trim() ||
    `http://localhost:${port}/api/auth/google/callback`;
  return {
    clientId: env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
    callbackUrl,
  };
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function buildGoogleAuthUrl(state: string): string {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new AppError(
      ERROR_MESSAGES.OAUTH_GOOGLE_NOT_CONFIGURED,
      503,
      ERROR_CODES.OAUTH_NOT_CONFIGURED,
    );
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state,
    prompt: 'select_account',
    access_type: 'online',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForAccessToken(code: string): Promise<string> {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new AppError(
      ERROR_MESSAGES.OAUTH_GOOGLE_NOT_CONFIGURED,
      503,
      ERROR_CODES.OAUTH_NOT_CONFIGURED,
    );
  }

  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new ValidationError({
      oauth: [payload.error_description || ERROR_MESSAGES.OAUTH_GOOGLE_FAILED],
    });
  }

  return payload.access_token;
}

async function fetchGoogleProfile(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new ValidationError({ oauth: [ERROR_MESSAGES.OAUTH_GOOGLE_FAILED] });
  }

  const profile = (await response.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email) {
    throw new ValidationError({ oauth: [ERROR_MESSAGES.OAUTH_GOOGLE_PROFILE_INCOMPLETE] });
  }

  return profile;
}

async function findOrCreateGoogleUser(profile: GoogleUserInfo): Promise<User> {
  const byGoogle = await User.findOne({
    where: { googleId: profile.sub },
    include: [{ model: Role, as: 'role' }],
  });
  if (byGoogle) {
    if (byGoogle.status === USER_STATUS.BLOCKED) {
      throw new ForbiddenError(ERROR_MESSAGES.ACCOUNT_BLOCKED);
    }
    return byGoogle;
  }

  const email = profile.email!.trim().toLowerCase();
  const existing = await repo.findByEmailIncludingDeleted(email);

  if (existing && !existing.deletedAt) {
    if (existing.status === USER_STATUS.BLOCKED) {
      throw new ForbiddenError(ERROR_MESSAGES.ACCOUNT_BLOCKED);
    }
    await existing.update({
      googleId: profile.sub,
      emailVerified: profile.email_verified ?? existing.emailVerified,
      avatarUrl: existing.avatarUrl || profile.picture || null,
      name: existing.name || profile.name || email.split('@')[0] || 'User',
    } as any);
    const linked = await repo.findByEmail(email);
    if (!linked) {
      throw new AppError(ERROR_MESSAGES.INTERNAL_ERROR, 500, ERROR_CODES.INTERNAL_ERROR);
    }
    return linked;
  }

  if (existing?.deletedAt) {
    throw new ValidationError({
      email: [ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED],
    });
  }

  const customerRole = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
  if (!customerRole) {
    throw new AppError('Default role not found', 500, ERROR_CODES.CONFIG_ERROR);
  }

  return User.create({
    email,
    passwordHash: null,
    googleId: profile.sub,
    name: profile.name?.trim() || email.split('@')[0] || 'User',
    phone: null,
    status: USER_STATUS.ACTIVE,
    roleId: customerRole.id,
    vendorId: null,
    emailVerified: profile.email_verified ?? true,
    emailMarketingConsent: false,
    emailSuppressed: false,
    avatarUrl: profile.picture ?? null,
  });
}

export async function completeGoogleOAuth(code: string, meta: SessionDeviceMeta) {
  const accessToken = await exchangeCodeForAccessToken(code);
  const profile = await fetchGoogleProfile(accessToken);
  const user = await findOrCreateGoogleUser(profile);
  return authService.issueSessionFromUser(user, meta);
}
