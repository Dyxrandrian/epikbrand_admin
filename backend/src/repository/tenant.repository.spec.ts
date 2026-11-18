import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaginationQueryDto } from '../dto/index.js';
import { Client } from '../entities/client.entity.js';
import { Project } from '../entities/project.entity.js';
import {
  ErrorCode,
  InvalidReferenceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '../exceptions/index.js';
import { createTestDataSource } from '../testing/test-db.js';
import { ClientRepository } from './client.repository.js';
import { ProjectRepository } from './project.repository.js';

const query = (overrides: Partial<PaginationQueryDto> = {}) =>
  Object.assign(new PaginationQueryDto(), overrides);

async function createCompany(ds: DataSource, name: string): Promise<string> {
  const rows: Array<{ id: string }> = await ds.query(
    'INSERT INTO companies (name) VALUES ($1) RETURNING id',
    [name],
  );
  return rows[0].id;
}

describe("Isolation multi-tenant des repositories", () => {
  let ds: DataSource;
  let clients: ClientRepository;
  let projects: ProjectRepository;
  let A: string;
  let B: string;
  let a1: Client;
  let a2: Client;
  let a3: Client;
  let b1: Client;

  const newClient = async (companyId: string, companyName: string): Promise<Client> => {
    const created = await clients.createOne(companyId, { companyName });
    return clients.getById(companyId, created.id);
  };

  beforeAll(async () => {
    ds = await createTestDataSource();
    clients = new ClientRepository(ds.getRepository(Client));
    projects = new ProjectRepository(ds.getRepository(Project));

    A = await createCompany(ds, 'Entreprise A (test)');
    B = await createCompany(ds, 'Entreprise B (test)');

    a1 = await newClient(A, 'A - Client 1');
    a2 = await newClient(A, 'A - Client 2');
    a3 = await newClient(A, 'A - Client 3');
    b1 = await newClient(B, 'B - Client 1');
    await newClient(B, 'B - Client 2');
  });

  afterAll(async () => {
    if (!ds?.isInitialized) return;
    const ids = [A, B].filter(Boolean);
    // Ordre voulu : projets, clients, puis entreprises (clés étrangères RESTRICT)
    await ds.query('DELETE FROM projects WHERE company_id = ANY($1)', [ids]);
    await ds.query('DELETE FROM clients WHERE company_id = ANY($1)', [ids]);
    await ds.query('DELETE FROM companies WHERE id = ANY($1)', [ids]);
    await ds.destroy();
  });

  describe('lecture', () => {
    it("ne voit pas une ressource d'une autre entreprise", async () => {
      expect(await clients.findById(B, a1.id)).toBeNull();
      expect(await clients.findById(A, a1.id)).not.toBeNull();
    });

    it("404 identique pour une ressource étrangère et une ressource inexistante", async () => {
      const foreign = await clients.getById(B, a1.id).catch((e: unknown) => e);
      const missing = await clients.getById(B, randomUUID()).catch((e: unknown) => e);

      expect(foreign).toBeInstanceOf(ResourceNotFoundException);
      expect(missing).toBeInstanceOf(ResourceNotFoundException);
      expect((foreign as Error).message).toBe((missing as Error).message);
    });

    it('refuse un appel sans companyId', async () => {
      await expect(clients.findById(undefined as never, a1.id)).rejects.toThrow(
        'companyId obligatoire',
      );
      await expect(clients.findById('', a1.id)).rejects.toThrow('companyId obligatoire');
    });

    it("les listes ne contiennent que les lignes de l'entreprise", async () => {
      const listA = await clients.list(A, query({ per_page: 100 }));
      const listB = await clients.list(B, query({ per_page: 100 }));

      expect(listA.items.length).toBeGreaterThanOrEqual(3);
      expect(listA.items.every((c) => c.companyId === A)).toBe(true);
      expect(listB.items.every((c) => c.companyId === B)).toBe(true);
      expect(listA.items.map((c) => c.id)).not.toContain(b1.id);
      expect(listB.items.map((c) => c.id)).not.toContain(a1.id);
    });

    it('la pagination parcourt toutes les lignes sans doublon ni trou', async () => {
      const first = await clients.list(A, query({ per_page: 2 }));
      const seen: string[] = first.items.map((c) => c.id);

      for (let page = 2; page <= first.totalPages; page++) {
        const next = await clients.list(A, query({ per_page: 2, page }));
        seen.push(...next.items.map((c) => c.id));
      }

      expect(seen.length).toBe(first.total);
      expect(new Set(seen).size).toBe(first.total);
    });

    it('trie selon un champ autorisé et refuse les autres', async () => {
      await newClient(A, 'Sort-Alpha');
      await newClient(A, 'Sort-Bravo');
      await newClient(A, 'Sort-Charlie');

      const sorted = await clients.list(A, query({ per_page: 100, sort: '-company_name' }));
      const names = sorted.items.map((c) => c.companyName).filter((n) => n.startsWith('Sort-'));
      expect(names).toEqual(['Sort-Charlie', 'Sort-Bravo', 'Sort-Alpha']);

      await expect(clients.list(A, query({ sort: '-password' }))).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });
  });

  describe('écriture', () => {
    it("createOne impose l'entreprise, même si le client en envoie une autre", async () => {
      const created = await clients.createOne(A, {
        companyName: 'Tentative de fraude',
        companyId: B,
      } as never);

      expect(await clients.findById(A, created.id)).not.toBeNull();
      expect(await clients.findById(B, created.id)).toBeNull();
    });

    it("une modification depuis une autre entreprise donne 404 et ne change rien", async () => {
      await expect(
        clients.updateWithVersion(B, a1.id, a1.version, { companyName: 'Pirate' }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);

      expect((await clients.getById(A, a1.id)).companyName).toBe('A - Client 1');
    });

    it("verrouillage optimiste : version périmée = 409, version courante = +1", async () => {
      const c = await newClient(A, 'Version test');

      const updated = await clients.updateWithVersion(A, c.id, c.version, {
        companyName: 'Version test v2',
      });
      // +1 exactement : confirme qu'aucun trigger ne double l'incrément
      expect(updated.version).toBe(c.version + 1);

      await expect(
        clients.updateWithVersion(A, c.id, c.version, { companyName: 'Périmé' }),
      ).rejects.toMatchObject({ code: ErrorCode.VERSION_CONFLICT });

      expect((await clients.getById(A, c.id)).companyName).toBe('Version test v2');
    });

    it("une modification ne peut pas déplacer une ligne vers une autre entreprise", async () => {
      const c = await newClient(A, 'Déménagement');

      await clients.updateWithVersion(A, c.id, c.version, {
        companyName: 'Déménagement v2',
        companyId: B,
      } as never);

      const after = await clients.getById(A, c.id);
      expect(after.companyName).toBe('Déménagement v2');
      expect(after.companyId).toBe(A);
      expect(await clients.findById(B, c.id)).toBeNull();
    });

    it("une suppression depuis une autre entreprise donne 404 et la ligne reste", async () => {
      await expect(clients.deleteById(B, a2.id)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(await clients.findById(A, a2.id)).not.toBeNull();
    });

    it('withManager : une transaction annulée ne laisse rien', async () => {
      const before = (await clients.list(A, query({ per_page: 100 }))).total;

      await expect(
        ds.transaction(async (manager) => {
          await clients.withManager(manager).createOne(A, { companyName: 'Rollback' });
          throw new Error('annulation volontaire');
        }),
      ).rejects.toThrow('annulation volontaire');

      const after = (await clients.list(A, query({ per_page: 100 }))).total;
      expect(after).toBe(before);
    });
  });

  describe('archivage', () => {
    it("archive / restaure, et refuse depuis une autre entreprise", async () => {
      const c = await newClient(A, 'A archiver');

      await expect(clients.archive(B, c.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
      expect((await clients.getByIdIncludingArchived(A, c.id)).archivedAt).toBeNull();

      await clients.archive(A, c.id);

      // masqué par défaut, visible avec le filtre "only"
      expect(await clients.findById(A, c.id)).toBeNull();
      const defaults = await clients.list(A, query({ per_page: 100 }));
      expect(defaults.items.map((x) => x.id)).not.toContain(c.id);
      const archivedOnly = await clients.list(A, query({ per_page: 100 }), 'only');
      expect(archivedOnly.items.map((x) => x.id)).toContain(c.id);

      // non modifiable tant qu'il est archivé
      await expect(
        clients.updateWithVersion(A, c.id, c.version, { companyName: 'Interdit' }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);

      await expect(clients.restore(B, c.id)).rejects.toBeInstanceOf(ResourceNotFoundException);
      await clients.restore(A, c.id);
      expect(await clients.findById(A, c.id)).not.toBeNull();
    });
  });

  describe('références entre objets', () => {
    it("assertReference : même erreur pour un objet étranger et un objet inexistant", async () => {
      await expect(clients.assertReference(A, a1.id, 'client_id')).resolves.toBeUndefined();

      const foreign = await clients.assertReference(B, a1.id, 'client_id').catch((e: unknown) => e);
      const missing = await clients
        .assertReference(B, randomUUID(), 'client_id')
        .catch((e: unknown) => e);

      expect(foreign).toBeInstanceOf(InvalidReferenceException);
      expect(foreign).toMatchObject({
        code: ErrorCode.INVALID_REFERENCE,
        details: [{ field: 'client_id' }],
      });
      expect(missing).toBeInstanceOf(InvalidReferenceException);
      expect((foreign as Error).message).toBe((missing as Error).message);
    });

    it("les projets sont isolés et include ne charge que les relations autorisées", async () => {
      const project = await projects.createOne(A, { clientId: a3.id, title: 'Projet A' });

      const listA = await projects.list(A, query({ include: ['client'] }));
      const found = listA.items.find((p) => p.id === project.id);
      expect(found?.client?.id).toBe(a3.id);

      const listB = await projects.list(B, query({ per_page: 100 }));
      expect(listB.items.map((p) => p.id)).not.toContain(project.id);
      expect(await projects.findById(B, project.id)).toBeNull();

      await expect(projects.list(A, query({ include: ['tasks'] }))).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });
  });
});