declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        roleId: string;
        vendorId: string | null;
        deliveryAgentId: string | null;
        role: { name: string };
        /** Set only when this request is running under an admin impersonation token. */
        impersonatedBy?: string | null;
      };
      requestId: string;
    }
  }
}

export {};
