import { IsOptional, IsUUID } from 'class-validator';

export class ReassignQueryDto {
  /** Élément vers lequel déplacer les objets rattachés avant la suppression. */
  @IsOptional()
  @IsUUID('all', { message: 'reassign_to doit être un UUID valide.' })
  reassign_to?: string;
}