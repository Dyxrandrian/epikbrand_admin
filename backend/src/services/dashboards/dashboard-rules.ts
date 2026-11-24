export const DASHBOARD_RULES = {
  defaultMonths: 12,
  /** Taille des classements */
  topClients: 5,
  topOffers: 5,
  topTeam: 5,
  topClientsYear: 10,
  /** Prévisions de trésorerie : nombre de mois à venir */
  forecastMonths: 3,
  /** Projet à risque : échéance dans N jours avec moins de P % de progression */
  projectAtRiskDays: 14,
  projectAtRiskProgress: 50,
  /** CRM */
  clientFollowUpDays: 30,
  clientDormantDays: 90,
  /** Surcharge d'une personne : tâches ouvertes ou en retard */
  workloadOpenTasks: 10,
  workloadOverdueTasks: 3,
  /** Concentration du risque client : part du CA (en %) du premier client et des trois premiers */
  concentration: { highTop1: 40, highTop3: 70, mediumTop1: 25, mediumTop3: 50 },
  throughputWeeks: 12,
  listLimit: 10,
  recentItems: 5,
} as const;