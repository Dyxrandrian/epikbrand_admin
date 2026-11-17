import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Unique } from 'typeorm';
import { Company } from './company.entity.js';
import { User } from './user.entity.js';
import { SalaryItem } from './salary-item.entity.js';
import { SalaryStatus, PaymentMethod } from '../enums/app.enums.js';

@Entity('salaries')
@Unique('unique_user_monthly_salary', ['companyId', 'userId', 'month'])
export class Salary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 7 })
  month: string;

  @Column({ type: 'enum', enum: SalaryStatus, enumName: 'salary_status', default: SalaryStatus.PENDING })
  status: SalaryStatus;

  @Column({ name: 'payment_date', type: 'date', nullable: true })
  paymentDate: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: PaymentMethod, enumName: 'payment_method', default: PaymentMethod.VIREMENT })
  paymentMethod: PaymentMethod;

  @Column({ name: 'base_salary', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  baseSalary: number;

  @Column({ name: 'gross_salary', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  grossSalary: number;

  @Column({ name: 'total_deductions', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  totalDeductions: number;

  @Column({ name: 'net_salary', type: 'numeric', precision: 12, scale: 2, default: 0.00 })
  netSalary: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Company, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @OneToMany(() => SalaryItem, (item) => item.salary, { cascade: true })
  items: SalaryItem[];
}