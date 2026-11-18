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

/** Profil complet : réservé à l'utilisateur lui-même (et, plus tard, admin/manager). */
export function toProfile(user: User) {
  return {
    ...toAuthUser(user),
    phone: user.phone,
    address: user.address,
    matricule: user.matricule,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
  };
}