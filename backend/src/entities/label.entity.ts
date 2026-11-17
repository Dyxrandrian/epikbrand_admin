import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Company } from './company.entity.js';

@Entity('labels')
@Unique(['companyId', 'name'])
export class Label {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  /** Couleur hexadécimale, ex. #6B7280 */
  @Column({ type: 'varchar', length: 7, default: '#6B7280' })
  color: string;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;
}
