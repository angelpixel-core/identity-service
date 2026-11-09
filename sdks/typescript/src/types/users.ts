export interface GetUserProfileParams {
  token: string;
  tenantId: string;
}

export interface GetUserByIdParams {
  userId: string;
  token: string;
  tenantId: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  tenantId: string;
  roles: string[];
  createdAt?: string;
}

