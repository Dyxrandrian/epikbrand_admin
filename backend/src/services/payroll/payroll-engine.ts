import type { RuleBracket } from '../../entities/payroll-rule.entity.js';
import { SalaryItemType } from '../../enums/app.enums.js';
import { RuleBase, RuleType } from '../../enums/payroll.enums.js';
import { BusinessRuleException, ErrorCode } from '../../exceptions/index.js';

export interface EngineRule {
  id: string | null;
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
}

export interface ManualLine {
  type: SalaryItemType;
  code: string;
  label: string;
  baseAmount: number | null;
  rate: number | null;
  amount: number;
}

export interface PayslipLine {
  type: SalaryItemType;
  code: string;
  label: string;
  baseAmount: number | null;
  rate: number | null;
  amount: number;
  ruleId: string | null;
  isManual: boolean;
}

export interface PayslipComputation {
  baseSalary: number;
  lines: PayslipLine[];
  gross: number;
  totalDeductions: number;
  net: number;
}

const MAX_CENTS = 999_999_999_999n; // limite de numeric(12,2)

const toCents = (value: number): bigint => BigInt(Math.round(value * 100));
const fromCents = (cents: bigint): number => Number(cents) / 100;
const toBasisPoints = (rate: number): bigint => BigInt(Math.round(rate * 10_000));
/** Division arrondie (moitié vers le haut) ; valeurs positives uniquement. */
const divRound = (n: bigint, d: bigint): bigint => (n + d / 2n) / d;

interface Context {
  baseSalary: bigint;
  gross: bigint;
  taxable: bigint;
  dependents: bigint;
}

interface Evaluation {
  base: bigint | null;
  rate: number | null;
  amount: bigint;
}

/** Plafond, puis arrondi à l'inférieur. */
function shapeBase(rule: EngineRule, raw: bigint): bigint {
  let base = raw < 0n ? 0n : raw;
  if (rule.baseCap !== null) {
    const cap = toCents(rule.baseCap);
    if (base > cap) base = cap;
  }
  if (rule.roundingStep !== null) {
    const step = toCents(rule.roundingStep);
    if (step > 0n) base -= base % step;
  }
  return base;
}

/** Somme exacte des tranches (en centimes × points de base), arrondie une seule fois. */
function progressiveAmount(base: bigint, brackets: readonly RuleBracket[]): bigint {
  let total = 0n;
  let lower = 0n;
  for (const bracket of brackets) {
    const upper = bracket.up_to === null ? null : toCents(bracket.up_to);
    const top = upper === null || base < upper ? base : upper;
    if (top > lower) total += (top - lower) * toBasisPoints(bracket.rate);
    if (upper === null || base <= upper) break;
    lower = upper;
  }
  return divRound(total, 10_000n);
}

function evaluate(rule: EngineRule, ctx: Context): Evaluation | null {
  if (rule.ruleType === RuleType.FIXED) {
    return { base: null, rate: null, amount: toCents(rule.fixedAmount ?? 0) };
  }

  const raw =
    rule.baseKind === RuleBase.GROSS
      ? ctx.gross
      : rule.baseKind === RuleBase.TAXABLE_INCOME
        ? ctx.taxable
        : ctx.baseSalary;
  const base = shapeBase(rule, raw);
  if (base <= 0n) return null; // rien à calculer

  let amount: bigint;
  let rate: number | null = null;

  if (rule.ruleType === RuleType.RATE) {
    rate = rule.rate ?? 0;
    amount = divRound(base * toBasisPoints(rate), 10_000n);
  } else {
    amount = progressiveAmount(base, rule.brackets ?? []);
    const reduction = toCents(rule.familyReduction) * ctx.dependents;
    amount = amount > reduction ? amount - reduction : 0n;
  }

  if (rule.minimumAmount !== null) {
    const minimum = toCents(rule.minimumAmount);
    if (amount < minimum) amount = minimum;
  }
  return { base, rate, amount };
}

const byPosition = (a: EngineRule, b: EngineRule): number =>
  a.position - b.position || a.code.localeCompare(b.code);

function ruleLine(rule: EngineRule, result: Evaluation): PayslipLine {
  return {
    type: rule.itemType,
    code: rule.code,
    label: rule.label,
    baseAmount: result.base === null ? null : fromCents(result.base),
    rate: result.rate,
    amount: fromCents(result.amount),
    ruleId: rule.id,
    isManual: false,
  };
}

/** Une ligne manuelle donnant base ET taux doit être cohérente avec son montant. */
function manualLine(line: ManualLine): PayslipLine {
  if (line.baseAmount !== null && line.rate !== null) {
    const expected = divRound(toCents(line.baseAmount) * toBasisPoints(line.rate), 10_000n);
    if (expected !== toCents(line.amount)) {
      throw new BusinessRuleException(
        `La ligne « ${line.label} » est incohérente : ${line.baseAmount} × ${line.rate} donne ${fromCents(expected)}, pas ${line.amount}.`,
        ErrorCode.AMOUNT_MISMATCH,
        { code: line.code, expected_amount: fromCents(expected), amount: line.amount },
      );
    }
  }
  return {
    type: line.type,
    code: line.code,
    label: line.label,
    baseAmount: line.baseAmount,
    rate: line.rate,
    amount: line.amount,
    ruleId: null,
    isManual: true,
  };
}

/**
 * Calcule un bulletin : gains (règles puis lignes manuelles), brut, retenues (règles puis lignes
 * manuelles), net. Les règles de retenue ne s'appliquent que si le brut est positif.
 */
export function computePayslip(input: {
  baseSalary: number;
  dependents: number;
  rules: readonly EngineRule[];
  manualLines: readonly ManualLine[];
}): PayslipComputation {
  const base = toCents(input.baseSalary);
  const rules = [...input.rules].sort(byPosition);
  const lines: PayslipLine[] = [];
  const dependents = BigInt(Math.max(0, input.dependents));

  // ----- Gains -----
  let earnings = 0n;
  const earningContext: Context = { baseSalary: base, gross: base, taxable: base, dependents };
  for (const rule of rules.filter((r) => r.itemType === SalaryItemType.EARNING)) {
    if (rule.ruleType === RuleType.PROGRESSIVE) {
      throw new Error(`La règle « ${rule.code} » : un barème progressif ne peut pas être un gain.`);
    }
    const result = evaluate(rule, earningContext);
    if (!result || result.amount === 0n) continue;
    lines.push(ruleLine(rule, result));
    earnings += result.amount;
  }
  for (const manual of input.manualLines.filter((m) => m.type === SalaryItemType.EARNING)) {
    lines.push(manualLine(manual));
    earnings += toCents(manual.amount);
  }

  const gross = base + earnings;
  if (gross > MAX_CENTS) throw new BusinessRuleException('Le salaire brut est trop élevé.');

  // ----- Retenues -----
  let deductions = 0n;
  let reducers = 0n; // retenues qui diminuent le revenu imposable
  if (gross > 0n) {
    for (const rule of rules.filter((r) => r.itemType === SalaryItemType.DEDUCTION)) {
      const result = evaluate(rule, { baseSalary: base, gross, taxable: gross - reducers, dependents });
      if (!result || result.amount === 0n) continue;
      lines.push(ruleLine(rule, result));
      deductions += result.amount;
      if (rule.reducesTaxableIncome) reducers += result.amount;
    }
  }
  for (const manual of input.manualLines.filter((m) => m.type === SalaryItemType.DEDUCTION)) {
    lines.push(manualLine(manual));
    deductions += toCents(manual.amount);
  }

  const net = gross - deductions;
  if (net < 0n) {
    throw new BusinessRuleException(
      `Les retenues (${fromCents(deductions)}) dépassent le salaire brut (${fromCents(gross)}).`,
      ErrorCode.NEGATIVE_NET,
      { gross_salary: fromCents(gross), total_deductions: fromCents(deductions) },
    );
  }

  return {
    baseSalary: fromCents(base),
    lines,
    gross: fromCents(gross),
    totalDeductions: fromCents(deductions),
    net: fromCents(net),
  };
}