import { Injectable } from '@nestjs/common';
import { mapDto } from '../../dto/map-dto.js';
import type {
  CreateStructureElementDto,
  StructureListQueryDto,
  UpdateStructureElementDto,
} from '../../dto/structure/structure.dto.js';
import { ConflictAppException, ErrorCode } from '../../exceptions/index.js';
import { toStructureElement, toStructureGroups } from '../../mapper/article.mapper.js';
import { AgencyStructureRepository } from '../../repository/agency-structure.repository.js';
import { StructureElementTypeRepository } from '../../repository/config-lists.repositories.js';
import type { AuthenticatedUser } from '../../security/index.js';

const UPDATE_MAP = { type_id: 'typeId', value: 'value', description: 'description' } as const;

@Injectable()
export class AgencyStructureService {
  constructor(
    private readonly elements: AgencyStructureRepository,
    private readonly types: StructureElementTypeRepository,
  ) {}

  /** Liste groupée par type ; avec une recherche, seuls les types qui ont des résultats. */
  async list(viewer: AuthenticatedUser, query: StructureListQueryDto) {
    const { companyId } = viewer;
    const [types, elements] = await Promise.all([
      this.elements.types(companyId, query.type_id),
      this.elements.list(companyId, { typeId: query.type_id, q: query.q }),
    ]);

    const groups = toStructureGroups(types, elements);
    return query.q ? groups.filter((group) => group.elements.length > 0) : groups;
  }

  async get(viewer: AuthenticatedUser, id: string) {
    return toStructureElement(await this.elements.getDetailed(viewer.companyId, id));
  }

  async create(user: AuthenticatedUser, dto: CreateStructureElementDto) {
    const { companyId } = user;
    await this.types.assertReference(companyId, dto.type_id, 'type_id'); // 422 si étranger
    await this.assertValueFree(companyId, dto.type_id, dto.value);

    const created = await this.elements.insertElement(companyId, {
      typeId: dto.type_id,
      value: dto.value,
      description: dto.description ?? null,
    });
    return toStructureElement(await this.elements.getDetailed(companyId, created.id));
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateStructureElementDto) {
    const { companyId } = user;
    const before = await this.elements.getById(companyId, id); // 404
    const changes = mapDto(dto, UPDATE_MAP);

    if (dto.type_id !== undefined && dto.type_id !== before.typeId) {
      await this.types.assertReference(companyId, dto.type_id, 'type_id');
    }
    if (dto.value !== undefined || dto.type_id !== undefined) {
      await this.assertValueFree(
        companyId,
        dto.type_id ?? before.typeId,
        dto.value ?? before.value,
        id,
      );
    }

    if (Object.keys(changes).length > 0) await this.elements.changeElement(companyId, id, changes);
    return toStructureElement(await this.elements.getDetailed(companyId, id));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    await this.elements.deleteById(user.companyId, id);
  }

  private async assertValueFree(
    companyId: string,
    typeId: string,
    value: string,
    excludeId?: string,
  ): Promise<void> {
    if (await this.elements.valueTaken(companyId, typeId, value, excludeId)) {
      throw new ConflictAppException(
        `La valeur « ${value} » existe déjà dans ce type.`,
        ErrorCode.DUPLICATE_RESOURCE,
      );
    }
  }
}