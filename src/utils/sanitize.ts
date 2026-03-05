import type { User } from '../types/models.js';

export function publicUser(user: User): Omit<User, 'pinHash'> {
  const { pinHash, ...rest } = user;
  void pinHash;
  return rest;
}
