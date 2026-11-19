import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsController } from '../controller/clients/clients.controller.js';
import { InteractionsController } from '../controller/clients/interactions.controller.js';
import { Client } from '../entities/client.entity.js';
import { Interaction } from '../entities/interaction.entity.js';
import { Project } from '../entities/project.entity.js';
import { ClientRepository } from '../repository/client.repository.js';
import { InteractionRepository } from '../repository/interaction.repository.js';
import { ProjectRepository } from '../repository/project.repository.js';
import { ClientService } from '../services/clients/client.service.js';
import { InteractionService } from '../services/clients/interaction.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Client, Interaction, Project])],
  controllers: [ClientsController, InteractionsController],
  providers: [
    ClientRepository,
    InteractionRepository,
    ProjectRepository,
    ClientService,
    InteractionService,
  ],
})
export class CrmModule {}