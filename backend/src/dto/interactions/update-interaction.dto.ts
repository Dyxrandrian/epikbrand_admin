import { ValidateIf } from 'class-validator';
import type { InteractionType } from '../../enums/app.enums.js';
import {
  InteractionDateField,
  InteractionSummaryField,
  InteractionTypeField,
} from './interaction-fields.js';

export class UpdateInteractionDto {
  @ValidateIf((o: UpdateInteractionDto) => o.type !== undefined)
  @InteractionTypeField()
  type?: InteractionType;

  @ValidateIf((o: UpdateInteractionDto) => o.summary !== undefined)
  @InteractionSummaryField()
  summary?: string;

  @ValidateIf((o: UpdateInteractionDto) => o.interaction_date !== undefined)
  @InteractionDateField()
  interaction_date?: string;
}