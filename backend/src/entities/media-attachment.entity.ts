import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Check, Index } from 'typeorm';
import type { Company } from './company.entity.js';
import type { Task } from './task.entity.js';
import type { Project } from './project.entity.js';
import type { AgencyArticle } from './agency-article.entity.js';
import type { User } from './user.entity.js';
import { MediaPurpose } from '../enums/app.enums.js';
import { bigintTransformer } from '../transformers/numeric.transformer.js';

/**
 * purpose = 'attachment' : exactement un parent (task, project ou article).
 * Autres purposes : aucun parent.
 */
@Index('idx_media_company_created', { synchronize: false })
@Index('idx_media_task', { synchronize: false })
@Index('idx_media_project', { synchronize: false })
@Index('idx_media_article', { synchronize: false })
@Index('idx_media_uploader', { synchronize: false })
@Check('chk_media_purpose', `"purpose" IN ('attachment', 'logo', 'cover', 'avatar', 'receipt')`)
@Check('chk_media_parent', `("purpose" = 'attachment' AND num_nonnulls("task_id", "project_id", "article_id") = 1) OR ("purpose" <> 'attachment' AND num_nonnulls("task_id", "project_id", "article_id") = 0)`)
@Entity('media_attachments')
export class MediaAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 20, default: MediaPurpose.ATTACHMENT })
  purpose: MediaPurpose;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'file_url', type: 'text' })
  fileUrl: string;

  @Column({ name: 'file_type', type: 'varchar', length: 100 })
  fileType: string;

  @Column({ name: 'file_size', type: 'bigint', transformer: bigintTransformer })
  fileSize: number;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'article_id', type: 'uuid', nullable: true })
  articleId: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('Task', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @ManyToOne('Project', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @ManyToOne('AgencyArticle', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article: AgencyArticle | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by' })
  uploadedBy: User | null;
}