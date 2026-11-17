import type { User } from '../entities/user.entity.js';

export function toAuthUser(user: User) {
  return {
    id: user.id,
    company_id: user.companyId,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_url: user.avatarUrl,
    job_title: user.jobTitle,
    is_verified: user.isVerified,
  };
}