import { describe, expect, it } from 'vitest';
import { diffChanges, snapshot } from './audit-changes.js';

describe('snapshot', () => {
  it('ne garde que les champs listés, en snake_case, et masque les secrets', () => {
    const result = snapshot(
      {
        name: 'Awa',
        jobTitle: 'Dev',
        passwordHash: 'argon2$secret',
        ignored: 'x',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      ['name', 'jobTitle', 'passwordHash', 'createdAt'],
    );

    expect(result).toEqual({
      name: 'Awa',
      job_title: 'Dev',
      password_hash: '[masqué]',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(result).not.toHaveProperty('ignored');
  });

  it('tronque les textes très longs', () => {
    const result = snapshot({ notes: 'x'.repeat(600) }, ['notes']);
    expect((result.notes as string).length).toBe(501);
    expect((result.notes as string).endsWith('…')).toBe(true);
  });
});

describe('diffChanges', () => {
  it('ne contient que les champs modifiés', () => {
    const result = diffChanges(
      { name: 'A', phone: null, role: 'admin' },
      { name: 'B', phone: null, role: 'admin' },
      ['name', 'phone', 'role'],
    );
    expect(result).toEqual({ before: { name: 'A' }, after: { name: 'B' } });
  });

  it("renvoie null quand rien n'a changé", () => {
    expect(diffChanges({ name: 'A' }, { name: 'A' }, ['name'])).toBeNull();
  });

  it('compare les dates par valeur', () => {
    const result = diffChanges(
      { createdAt: new Date('2026-01-01T00:00:00Z') },
      { createdAt: new Date('2026-01-01T00:00:00Z') },
      ['createdAt'],
    );
    expect(result).toBeNull();
  });

  it("masque les secrets mais montre qu'ils ont changé", () => {
    const result = diffChanges({ passwordHash: 'hash-un' }, { passwordHash: 'hash-deux' }, [
      'passwordHash',
    ]);
    expect(result).toEqual({
      before: { password_hash: '[masqué]' },
      after: { password_hash: '[masqué]' },
    });
    expect(JSON.stringify(result)).not.toContain('hash-un');
    expect(JSON.stringify(result)).not.toContain('hash-deux');
  });
});