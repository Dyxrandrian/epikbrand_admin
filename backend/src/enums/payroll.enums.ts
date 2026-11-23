/** Colonnes VARCHAR + CHECK (pas un type ENUM PostgreSQL) */
export enum RuleType {
  RATE = 'rate',
  FIXED = 'fixed',
  PROGRESSIVE = 'progressive',
}

export enum RuleBase {
  BASE_SALARY = 'base_salary',
  GROSS = 'gross',
  TAXABLE_INCOME = 'taxable_income',
}