import type { RuleBracket } from '../../entities/payroll-rule.entity.js';
import { SalaryItemType } from '../../enums/app.enums.js';
import { RuleBase, RuleType } from '../../enums/payroll.enums.js';
import { ValidationFailedException } from '../../exceptions/index.js';
import type { ErrorDetail } from '../../exceptions/index.js';

export interface RuleShape {
  code: string;
  label: string;
  itemType: SalaryItemType;
  ruleType: RuleType;
  baseKind: RuleBase | null;
  rate: number | null;
  fixedAmount: number | null;
  baseCap: number | null;
  roundingStep: number | null;
  brackets: RuleBracket[] | null;
  familyReduction: number;
  minimumAmount: number | null;
  reducesTaxableIncome: boolean;
  position: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

const detail = (field: string, message: string): ErrorDetail => ({
  field,
  reason: 'invalidPayrollRule',
  message,
});

/** Vérifie la règle et renvoie sa forme normalisée (champs sans objet remis à vide). */
export function normalizeRuleShape(rule: RuleShape): RuleShape {
  const problems: ErrorDetail[] = [];
  const earning = rule.itemType === SalaryItemType.EARNING;

  if (rule.effectiveTo !== null && rule.effectiveTo < rule.effectiveFrom) {
    problems.push(detail('effective_to', "La fin de validité ne peut pas précéder le début."));
  }

  const out: RuleShape = { ...rule };

  if (rule.ruleType === RuleType.FIXED) {
    if (rule.fixedAmount === null) {
      problems.push(detail('fixed_amount', 'Un montant fixe est obligatoire pour une règle de type fixed.'));
    }
    Object.assign(out, {
      baseKind: null,
      rate: null,
      baseCap: null,
      roundingStep: null,
      brackets: null,
      familyReduction: 0,
      minimumAmount: null,
    });
  } else {
    if (rule.baseKind === null) {
      problems.push(detail('base_kind', 'La base de calcul est obligatoire (base_salary, gross ou taxable_income).'));
    }
    if (earning && rule.baseKind !== null && rule.baseKind !== RuleBase.BASE_SALARY) {
      problems.push(detail('base_kind', 'Un gain se calcule sur base_salary uniquement.'));
    }

    if (rule.ruleType === RuleType.RATE) {
      if (rule.rate === null) problems.push(detail('rate', 'Le taux est obligatoire pour une règle de type rate.'));
      Object.assign(out, { fixedAmount: null, brackets: null, familyReduction: 0 });
    } else {
      if (earning) problems.push(detail('rule_type', 'Un barème progressif ne peut être qu\'une retenue.'));
      problems.push(...checkBrackets(rule.brackets));
      Object.assign(out, { rate: null, fixedAmount: null });
    }
  }

  if (earning) out.reducesTaxableIncome = false;

  if (problems.length > 0) throw new ValidationFailedException(problems);
  return out;
}

function checkBrackets(brackets: RuleBracket[] | null): ErrorDetail[] {
  if (!brackets || brackets.length === 0) {
    return [detail('brackets', 'Un barème progressif exige au moins une tranche.')];
  }
  const problems: ErrorDetail[] = [];
  let previous = 0;

  brackets.forEach((bracket, index) => {
    const last = index === brackets.length - 1;
    if (bracket.up_to === null) {
      if (!last) problems.push(detail(`brackets.${index}.up_to`, 'Seule la dernière tranche peut être sans limite.'));
      return;
    }
    if (last) problems.push(detail(`brackets.${index}.up_to`, 'La dernière tranche doit être sans limite (up_to: null).'));
    if (bracket.up_to <= previous) {
      problems.push(detail(`brackets.${index}.up_to`, 'Les tranches doivent être strictement croissantes.'));
    }
    previous = bracket.up_to;
  });
  return problems;
}