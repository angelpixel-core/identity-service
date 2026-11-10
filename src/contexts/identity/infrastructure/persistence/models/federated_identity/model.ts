export interface FederatedIdentityDatabaseModel {
  id: string;
  user_id: string;
  tenant_id: string;
  provider: string;
  external_subject_id: string;
  external_email: string;
  created_at: Date | string;
  updated_at: Date | string;
}
