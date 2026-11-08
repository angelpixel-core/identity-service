export interface RegisterUserParams {
  tenantId: string;
  email: string;
  password: string;
  name?: string;
  roles?: string[];
}

export interface RegisterUserResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name?: string;
    tenantId: string;
    roles: string[];
    createdAt?: string;
  };
}

