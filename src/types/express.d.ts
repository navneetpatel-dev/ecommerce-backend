declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        roleId: string;
        vendorId: string | null;
        role: { name: string };
      };
      requestId: string;
    }
  }
}

export {};
