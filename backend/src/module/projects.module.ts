import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from '../controller/projects/projects.controller.js';
import { Client } from '../entities/client.entity.js';
import { Project } from '../entities/project.entity.js';
import { ClientRepository } from '../repository/client.repository.js';
import { ProjectRepository } from '../repository/project.repository.js';
import { ProjectService } from '../services/projects/project.service.js';
import { CompanyModule } from './company.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Client]), CompanyModule],
  controllers: [ProjectsController],
  providers: [ProjectRepository, ClientRepository, ProjectService],
  exports: [ProjectRepository],
})
export class ProjectsModule {}