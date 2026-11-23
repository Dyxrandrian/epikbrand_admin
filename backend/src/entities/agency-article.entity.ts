import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, VersionColumn, Index, Check } from 'typeorm';
import type { Company } from './company.entity.js';
import type { ArticleSection } from './article-section.entity.js';
import type { ArticleCategory } from './article-category.entity.js';
import type { User } from './user.entity.js';
import type { AgencyArticleVersion } from './agency-article-version.entity.js';

@Check('chk_article_title', 'length(btrim("title")) > 0')
@Check('chk_article_version', '"version" >= 1')
@Index('idx_articles_search_text', { synchronize: false })
@Index('idx_articles_company_updated', { synchronize: false })
@Index('idx_articles_section', { synchronize: false })
@Index('idx_articles_category', { synchronize: false })
@Index('idx_search_articles', { synchronize: false })
@Entity('agency_articles')
export class AgencyArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** JSON de blocs BlockNote, validé et normalisé par l'API */
  @Column({ type: 'text' })
  content: string;

  /** Texte brut extrait du contenu, pour la recherche. Jamais chargé avec l'article. */
  @Column({ name: 'search_text', type: 'text', default: '', select: false })
  searchText?: string;

  @Column({ name: 'section_id', type: 'uuid' })
  sectionId: string;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedById: string | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne('Company', { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne('ArticleSection', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'section_id' })
  section: ArticleSection;

  @ManyToOne('ArticleCategory', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category: ArticleCategory | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedBy: User | null;

  @OneToMany('AgencyArticleVersion', (articleVersion: any) => articleVersion.article)
  versions: AgencyArticleVersion[];
}