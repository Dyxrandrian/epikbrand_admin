import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Unique, Check } from 'typeorm';
import { Company } from './company.entity.js';
import { User } from './user.entity.js';
import { SalaryItem } from './salary-item.entity.js';
import { SalaryStatus, PaymentMethod } from '../enums/app.enums.js';
import { numericTransformer } from '../transformers/numeric.transformer.js';

@Check('chk_salary_net', '"net_salary" = "gross_salary" - "total_deductions"')
@Check('chk_salary_month', `"month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)
@Entity('salaries')
@Unique('unique_user_monthly_salary', ['companyId', 'userId', 'month'])
export class Salary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Format YYYY-MM */
  @Column({ type: 'char', length: 7 })
  month: string;

  @Column({ type: 'enum', enum: SalaryStatus, enumName: 'salary_status', default: SalaryStatus.PENDING })
  status: SalaryStatus;

  @Column({ name: 'payment_date', type: 'date', nullable: true })
  paymentDate: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, nullable: true, default: PaymentMethod.VIREMENT })
  paymentMethod: PaymentMethod | null;

  @Column({ name: 'base_salary', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  baseSalary: number;

  @Column({ name: 'gross_salary', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  grossSalary: number;

  @Column({ name: 'total_deductions', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  totalDeductions: number;

  /** Contrainte SQL : net_salary = gross_salary - total_deductions */
  @Column({ name: 'net_salary', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numericTransformer })
  netSalary: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => SalaryItem, (item) => item.salary)
  items: SalaryItem[];
}
