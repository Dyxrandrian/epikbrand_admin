import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogListQueryDto } from '../../dto/audit/audit-log-list-query.dto.js';
import { AuditLog } from '../../entities/audit-log.entity.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { AuditLogRepository } from '../../repository/audit-log.repository.js';
import { RequestContext } from '../../security/request-context.js';
import { createTestDataSource } from '../../testing/test-db.js';
import { AuditService } from './audit.service.js';

const query = (overrides: Partial<AuditLogListQueryDto> = {}) =>
  Object.assign(new AuditLogListQueryDto(), overrides);

describe("Journal d'audit", () => {
  let ds: DataSource;
  let audit: AuditService;
  let A: string;
  let B: string;
  let userA: string;

  const createCompany = async (name: string): Promise<string> => {
    const rows: Array<{ id: string }> = await ds.query(
      'INSERT INTO companies (name) VALUES ($1) RETURNING id',
      [name],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    ds = await createTestDataSource();
    audit = new AuditService(new AuditLogRepository(ds.getRepository(AuditLog)));

    A = await createCompany('Audit A (test)');
    B = await createCompany('Audit B (test)');

    const users: Array<{ id: string }> = await ds.query(
      `INSERT INTO users (company_id, name, email, role)
       VALUES ($1, 'Auditeur', $2, 'admin') RETURNING id`,
      [A, `auditeur-${randomUUID()}@epikbrand.test`],
    );
    userA = users[0].id;
  });

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    // Les utilisateurs et les lignes d'audit partent en cascade avec l'entreprise
    await ds.query('DELETE FROM companies WHERE id = ANY($1)', [[A, B].filter(Boolean)]);
    await ds.destroy();
  });

  it("enregistre l'entreprise, l'acteur, l'IP et les changements explicites", async () => {
    const entityId = randomUUID();

    await audit.record({
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CLIENT,
      entityId,
      companyId: A,
      userId: userA,
      ip: '203.0.113.7',
      changes: { after: { company_name: 'Client X' } },
    });

    const result = await audit.list(A, query({ entity_id: entityId }));
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      companyId: A,
      userId: userA,
      action: 'create',
      entityType: 'client',
      ipAddress: '203.0.113.7',
      changes: { after: { company_name: 'Client X' } },
    });
  });

  it("reprend l'acteur et l'IP du contexte de la requête", async () => {
    const entityId = randomUUID();

    await RequestContext.run(
      { ip: '198.51.100.4', userAgent: null, userId: userA, companyId: A },
      () =>
        audit.record({
          action: AuditAction.VIEW,
          entityType: AuditEntityType.SALARY,
          entityId,
        }),
    );

    const result = await audit.list(A, query({ entity_id: entityId }));
    expect(result.items[0]).toMatchObject({
      companyId: A,
      userId: userA,
      action: 'view',
      ipAddress: '198.51.100.4',
    });
  });

  it("refuse d'écrire sans entreprise connue", async () => {
    await expect(
      audit.record({ action: AuditAction.CREATE, entityType: AuditEntityType.CLIENT }),
    ).rejects.toThrow('entreprise inconnue');
  });

  it("le journal d'une entreprise est invisible pour une autre", async () => {
    const entityId = randomUUID();
    await audit.record({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.INVOICE,
      entityId,
      companyId: A,
      userId: null,
    });

    expect((await audit.list(A, query({ entity_id: entityId }))).total).toBe(1);
    expect((await audit.list(B, query({ entity_id: entityId }))).total).toBe(0);
    await expect(audit.list('', query())).rejects.toThrow('companyId obligatoire');
  });

  it("une transaction annulée n'écrit rien dans le journal", async () => {
    const entityId = randomUUID();

    await expect(
      ds.transaction(async (manager) => {
        await audit.record(
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.EXPENSE,
            entityId,
            companyId: A,
            userId: null,
          },
          manager,
        );
        throw new Error('annulation volontaire');
      }),
    ).rejects.toThrow('annulation volontaire');

    expect((await audit.list(A, query({ entity_id: entityId }))).total).toBe(0);
  });

  it("recordQuietly n'échoue jamais, même si l'écriture est impossible", async () => {
    await expect(
      audit.recordQuietly({
        action: AuditAction.LOGIN,
        entityType: AuditEntityType.USER,
        entityId: 'pas-un-uuid',
        companyId: A,
        userId: null,
      }),
    ).resolves.toBeUndefined();
  });

  it('filtre par action et trie du plus récent au plus ancien', async () => {
    const entityId = randomUUID();
    for (const action of [AuditAction.CREATE, AuditAction.UPDATE, AuditAction.ARCHIVE]) {
      await audit.record({
        action,
        entityType: AuditEntityType.PROJECT,
        entityId,
        companyId: A,
        userId: null,
      });
    }

    const all = await audit.list(A, query({ entity_id: entityId }));
    expect(all.items.map((l) => l.action)).toEqual(['archive', 'update', 'create']);

    const filtered = await audit.list(
      A,
      query({ entity_id: entityId, action: AuditAction.UPDATE }),
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].action).toBe('update');
  });
});