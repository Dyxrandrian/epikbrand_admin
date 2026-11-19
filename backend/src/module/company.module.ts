import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyController } from '../controller/company/company.controller.js';
import { Company } from '../entities/company.entity.js';
import { CompanyRepository } from '../repository/company.repository.js';
import { CompanyService } from '../services/company/company.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [CompanyController],
  providers: [CompanyRepository, CompanyService],
})
export class CompanyModule {}