import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { PageQueryDto, SortOrder } from '../dto/index.js';
import { TaskComment } from '../entities/task-comment.entity.js';
import { ResourceNotFoundException } from '../exceptions/index.js';
import { TenantRepository } from './tenant.repository.js';

@Injectable()
export class TaskCommentRepository extends TenantRepository<TaskComment> {
  protected readonly alias = 'cmt';
  protected readonly label = 'Commentaire';
  protected readonly sortableFields = { created_at: 'createdAt' };
  protected readonly defaultSort: SortOrder = { created_at: 'ASC' }; // fil de discussion

  constructor(@InjectRepository(TaskComment) repo: Repository<TaskComment>) {
    super(repo);
  }

  listForTask(companyId: string, taskId: string, query: PageQueryDto) {
    const qb = this.scoped(companyId).andWhere('cmt.taskId = :cmtTaskId', { cmtTaskId: taskId });
    this.joinAuthor(qb);
    return this.paginate(qb, query);
  }

  /** Un commentaire avec son auteur (id, nom, avatar seulement). */
  async getDetailed(companyId: string, id: string): Promise<TaskComment> {
    const qb = this.scoped(companyId).andWhere('cmt.id = :cmtId', { cmtId: id });
    this.joinAuthor(qb);
    const comment = await qb.getOne();
    if (!comment) throw new ResourceNotFoundException(this.label);
    return comment;
  }

  private joinAuthor(qb: SelectQueryBuilder<TaskComment>): void {
    qb.leftJoin('cmt.user', 'inc_author').addSelect([
      'inc_author.id',
      'inc_author.name',
      'inc_author.avatarUrl',
    ]);
  }
}