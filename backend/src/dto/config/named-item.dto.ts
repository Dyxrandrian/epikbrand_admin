import { ValidateIf } from 'class-validator';
import { IsItemName } from './item-name.decorator.js';

export class CreateNamedItemDto {
  @IsItemName(100)
  name: string;
}

export class UpdateNamedItemDto {
  // ValidateIf : le nom peut être omis, mais jamais vidé ni mis à null
  @ValidateIf((o: UpdateNamedItemDto) => o.name !== undefined)
  @IsItemName(100)
  name?: string;
}