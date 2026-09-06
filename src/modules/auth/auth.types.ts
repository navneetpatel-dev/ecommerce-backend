export interface JwtPayload {
  sub: string;
  email: string;
  roleId: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  roleName?: string;
  /** Set only on a short-lived impersonation token: the acting admin's user id. */
  impersonatedBy?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
