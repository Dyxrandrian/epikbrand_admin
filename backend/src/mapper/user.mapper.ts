import type { User } from '../entities/user.entity.js';
import { UserRole } from '../enums/app.enums.js';
import type { AuthenticatedUser } from '../security/index.js';

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

/** Ce que voient tous les rôles : nom, e-mail professionnel, avatar, poste. */
export function toDirectoryUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatarUrl,
    job_title: user.jobTitle,
  };
}

/** Vue détaillée : admin, manager, ou l'utilisateur lui-même. */
export function toUserDetail(user: User) {
  return {
    ...toDirectoryUser(user),
    role: user.role,
    phone: user.phone,
    address: user.address,
    matricule: user.matricule,
    is_active: user.isActive,
    is_verified: user.isVerified,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
  };
}

export function toUserView(user: User, viewer: AuthenticatedUser) {
  const detailed = viewer.role !== UserRole.COLLABORATOR || viewer.id === user.id;
  return detailed ? toUserDetail(user) : toDirectoryUser(user);
}

/** Organigramme : utilisateurs regroupés par poste, sans poste en dernier. */
export function toDirectoryGroups(users: User[]) {
  const groups = new Map<string | null, ReturnType<typeof toDirectoryUser>[]>();
  for (const user of users) {
    const key = user.jobTitle?.trim() || null;
    const members = groups.get(key) ?? [];
    members.push(toDirectoryUser(user));
    groups.set(key, members);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'fr')))
    .map(([jobTitle, members]) => ({ job_title: jobTitle, users: members }));
}