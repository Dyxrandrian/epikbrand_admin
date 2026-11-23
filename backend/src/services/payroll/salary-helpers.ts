import type { PayrollRule } from '../../entities/payroll-rule.entity.js';
import type { SalaryItem } from '../../entities/salary-item.entity.js';
import type { EngineRule, ManualLine } from './payroll-engine.js';

export const toEngineRule = (rule: PayrollRule): EngineRule => ({
  id: rule.id,
  code: rule.code,
  label: rule.label,
  itemType: rule.itemType,
  ruleType: rule.ruleType,
  baseKind: rule.baseKind,
  rate: rule.rate,
  fixedAmount: rule.fixedAmount,
  baseCap: rule.baseCap,
  roundingStep: rule.roundingStep,
  brackets: rule.brackets,
  familyReduction: rule.familyReduction,
  minimumAmount: rule.minimumAmount,
  reducesTaxableIncome: rule.reducesTaxableIncome,
  position: rule.position,
});

export const toManualLine = (
  item: Pick<SalaryItem, 'type' | 'code' | 'label' | 'baseAmount' | 'rate' | 'amount'>,
): ManualLine => ({
  type: item.type,
  code: item.code,
  label: item.label,
  baseAmount: item.baseAmount,
  rate: item.rate,
  amount: item.amount,
});

export const unique = <T>(values: readonly T[] | undefined): T[] => [...new Set(values ?? [])];