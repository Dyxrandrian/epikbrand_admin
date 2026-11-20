import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpensesController } from '../controller/expenses/expenses.controller.js';
import { ExpenseCategory } from '../entities/expense-category.entity.js';
import { ExpenseItem } from '../entities/expense-item.entity.js';
import { Expense } from '../entities/expense.entity.js';
import { ExpenseCategoryRepository } from '../repository/config-lists.repositories.js';
import { ExpenseRepository } from '../repository/expense.repository.js';
import { ExpenseService } from '../services/expenses/expense.service.js';
import { CompanyModule } from './company.module.js';
import { FilesModule } from './files.module.js';
import { ProjectsModule } from './projects.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, ExpenseItem, ExpenseCategory]),
    CompanyModule,
    ProjectsModule,
    FilesModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpenseRepository, ExpenseCategoryRepository, ExpenseService],
  exports: [ExpenseRepository],
})
export class ExpensesModule {}