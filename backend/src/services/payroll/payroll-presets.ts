import { SalaryItemType } from '../../enums/app.enums.js';
import { RuleBase, RuleType } from '../../enums/payroll.enums.js';
import type { RuleShape } from './payroll-rule-shape.js';

export interface PayrollPreset {
  id: string;
  label: string;
  rules: RuleShape[];
}

const EFFECTIVE_FROM = '2026-01-01';

const base = (): Omit<RuleShape, 'code' | 'label' | 'ruleType' | 'baseKind' | 'position'> => ({
  itemType: SalaryItemType.DEDUCTION,
  rate: null,
  fixedAmount: null,
  baseCap: null,
  roundingStep: null,
  brackets: null,
  familyReduction: 0,
  minimumAmount: null,
  reducesTaxableIncome: false,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveTo: null,
  isActive: true,
});

/**
 * Valeurs 2026 fournies par l'entreprise. À faire valider par un comptable : elles changent avec
 * la loi de finances (créer alors une nouvelle version datée de chaque règle).
 */
export const PAYROLL_PRESETS: readonly PayrollPreset[] = [
  {
    id: 'mg-2026',
    label: 'Madagascar 2026 : CNaPS, OSTIE, IRSA (valeurs fournies par l\'entreprise)',
    rules: [
      {
        ...base(),
        code: 'CNAPS',
        label: 'CNaPS (part salariale)',
        ruleType: RuleType.RATE,
        baseKind: RuleBase.GROSS,
        rate: 0.01,
        baseCap: 2_400_000,
        reducesTaxableIncome: true,
        position: 10,
      },
      {
        ...base(),
        code: 'OSTIE',
        label: 'OSTIE (part salariale)',
        ruleType: RuleType.RATE,
        baseKind: RuleBase.GROSS,
        rate: 0.01,
        baseCap: 2_400_000,
        reducesTaxableIncome: true,
        position: 20,
      },
      {
        ...base(),
        code: 'IRSA',
        label: 'IRSA',
        ruleType: RuleType.PROGRESSIVE,
        baseKind: RuleBase.TAXABLE_INCOME,
        roundingStep: 100,
        brackets: [
          { up_to: 350_000, rate: 0 },
          { up_to: 400_000, rate: 0.05 },
          { up_to: 500_000, rate: 0.1 },
          { up_to: 600_000, rate: 0.15 },
          { up_to: 4_000_000, rate: 0.2 },
          { up_to: null, rate: 0.25 },
        ],
        familyReduction: 2000,
        minimumAmount: 3000,
        position: 30,
      },
    ],
  },
];