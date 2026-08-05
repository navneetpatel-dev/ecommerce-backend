export interface JwtPayload {
  sub: string;
  email: string;
  roleId: string;
  vendorId: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
