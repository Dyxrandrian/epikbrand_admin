export type ChartType =
  | 'kpi' | 'line' | 'bar' | 'stacked_bar' | 'horizontal_bar' | 'donut' | 'funnel' | 'table';

export interface ChartHint {
  type: ChartType;
  x?: string;
  y?: string[];
  unit?: 'currency' | 'percent' | 'count' | 'days';
}

/** Valeurs par défaut conseillées au frontend ; modifiables ici sans toucher au reste. */
export const CHARTS = {
  kpi: { type: 'kpi' },
  revenueEvolution: { type: 'line', x: 'month', y: ['revenue_ht', 'previous_year_revenue_ht', 'collected'], unit: 'currency' },
  cashBalance: { type: 'line', x: 'date', y: ['balance'], unit: 'currency' },
  rankingCurrency: { type: 'horizontal_bar', x: 'name', y: ['revenue_ht'], unit: 'currency' },
  rankingCount: { type: 'horizontal_bar', x: 'name', y: ['completed'], unit: 'count' },
  revenueVsExpenses: { type: 'bar', x: 'month', y: ['revenue_ht', 'expenses_ht', 'result_ht'], unit: 'currency' },
  breakdown: { type: 'donut', x: 'label', y: ['amount_ht'], unit: 'currency' },
  aging: { type: 'bar', x: 'bucket', y: ['amount'], unit: 'currency' },
  concentration: { type: 'donut', x: 'name', y: ['share_percent'], unit: 'percent' },
  funnel: { type: 'funnel', x: 'label', y: ['count'], unit: 'count' },
  forecast: { type: 'stacked_bar', x: 'month', y: ['expected_inflows', 'expected_outflows'], unit: 'currency' },
  payroll: { type: 'bar', x: 'month', y: ['gross', 'net'], unit: 'currency' },
  table: { type: 'table' },
  statusDonut: { type: 'donut', x: 'status', y: ['count'], unit: 'count' },
  countLine: { type: 'line', x: 'month', y: ['count'], unit: 'count' },
  weeklyBar: { type: 'bar', x: 'week', y: ['done'], unit: 'count' },
  workload: { type: 'horizontal_bar', x: 'name', y: ['open', 'overdue'], unit: 'count' },
  percentLine: { type: 'line', x: 'month', y: ['rate_percent'], unit: 'percent' },
  daysKpi: { type: 'kpi', unit: 'days' },
} as const satisfies Record<string, ChartHint>;

export const DEFINITIONS = {
  revenue: "Chiffre d'affaires HT = factures émises dans le mois moins avoirs émis dans le mois (brouillons et documents annulés exclus).",
  cash: 'Encaissements = paiements reçus ; décaissements = dépenses payées ; salaires = net des bulletins payés (admin seulement). Chaque montant compte à sa date de paiement.',
  collection: "Recouvrement = part déjà réglée (paiements et avoirs) des factures dont l'échéance tombe dans le mois.",
  topClients: "Chiffre d'affaires HT net du mois par client.",
  orders: "Commandes = devis acceptés dans le mois + factures émises dans le mois sans devis d'origine.",
  topOffers: "Offre = intitulé des lignes de facture (casse et accents ignorés), CA HT net du mois. À remplacer par un catalogue de produits.",
  topTeam: 'Tâches terminées dans le mois, par personne assignée ; « dans les délais » = terminée avant son échéance.',
  receivablesAging: "Ancienneté = jours écoulés depuis l'échéance de la facture ; « not_due » = pas encore échue.",
  concentration: 'Part du chiffre d’affaires des 12 derniers mois réalisée avec les premiers clients.',
  absenceRate: "Jours d'absence approuvés ÷ (effectif actuel × jours ouvrés du mois). Jours fériés non déduits.",
} as const;