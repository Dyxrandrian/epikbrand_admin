import { IsOptional } from 'class-validator';
import {
  InteractionDateField,
  InteractionSummaryField,
  InteractionTypeField,
} from './interaction-fields.js';
import type { InteractionType } from '../../enums/app.enums.js';

export class CreateInteractionDto {
  @InteractionTypeField()
  type: InteractionType;

  @InteractionSummaryField()
  summary: string;

  /** Par défaut : maintenant. Peut être antidatée, jamais dans le futur. */
  @IsOptional()
  @InteractionDateField()
  interaction_date?: string;
}