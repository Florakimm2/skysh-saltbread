export type User = {
    id: number;
    email: string;
    name: string;
    passwordHash: string;
    createdAt: string;
  };
  
  export type PublicUser = {
    id: number;
    email: string;
    name: string;
  };
  
  export type RefreshTokenRecord = {
    id: string;
    userId: number;
    tokenHash: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
  };
  
  export type SignupInput = {
    email: string;
    password: string;
    name: string;
  };
  
  export type LoginInput = {
    email: string;
    password: string;
  };