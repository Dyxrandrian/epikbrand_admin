import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from '../controller/files/files.controller.js';
import { MediaAttachment } from '../entities/media-attachment.entity.js';
import { FileRepository } from '../repository/file.repository.js';
import { FileAccessService } from '../services/files/file-access.service.js';
import { FileLinkService } from '../services/files/file-link.service.js';
import { FileService } from '../services/files/file.service.js';
import { createVirusScanner, VirusScanner } from '../services/files/scan/virus-scanner.js';
import { createFileStorage } from '../services/files/storage/create-file-storage.js';
import { FileStorage } from '../services/files/storage/file-storage.js';
import { CompanyModule } from './company.module.js';
import { ProjectsModule } from './projects.module.js';
import { TasksModule } from './tasks.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([MediaAttachment]), TasksModule, ProjectsModule, CompanyModule],
  controllers: [FilesController],
  providers: [
    FileRepository,
    { provide: FileStorage, inject: [ConfigService], useFactory: createFileStorage },
    { provide: VirusScanner, inject: [ConfigService], useFactory: createVirusScanner },
    FileLinkService,
    FileAccessService,
    FileService,
  ],
  exports: [FileRepository, FileStorage],
})
export class FilesModule {}