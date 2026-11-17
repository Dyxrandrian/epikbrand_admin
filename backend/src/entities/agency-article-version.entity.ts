import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { AgencyArticle } from './agency-article.entity.js';
import { User } from './user.entity.js';

@Entity('agency_article_versions')
@Unique(['articleId', 'version'])
export class AgencyArticleVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'article_id', type: 'uuid' })
  articleId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'edited_by', type: 'uuid', nullable: true })
  editedById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => AgencyArticle, (article) => article.versions, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article: AgencyArticle;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'edited_by' })
  editedBy: User | null;
}
