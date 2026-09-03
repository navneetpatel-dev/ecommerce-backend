export interface JwtPayload {
  sub: string;
  email: string;
  roleId: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  roleName?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
