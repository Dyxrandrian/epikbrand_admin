export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  COLLABORATOR = 'collaborator',
}

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum ProjectStatus {
  PENDING = 'pending',
  ONGOING = 'ongoing',
  DELIVERED = 'delivered',
}

export enum TaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  DONE = 'done',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum InvoiceDocumentType {
  QUOTE = 'quote',
  INVOICE = 'invoice',
  CREDIT_NOTE = 'credit_note',
}

export enum InvoicePaymentStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

export enum ExpenseStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum ExpenseRecurrence {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

export enum SalaryStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  VIREMENT = 'virement',
  CHEQUE = 'cheque',
  ESPECES = 'especes',
  MOBILE_MONEY = 'mobile_money',
  AUTRE = 'autre',
}

export enum SalaryItemType {
  EARNING = 'earning',
  DEDUCTION = 'deduction',
}

export enum UserTokenPurpose {
  VERIFY_EMAIL = 'verify_email',
  RESET_PASSWORD = 'reset_password',
  INVITATION = 'invitation',
}

/** Colonne VARCHAR + CHECK (pas un type ENUM PostgreSQL) */
export enum MediaPurpose {
  ATTACHMENT = 'attachment',
  LOGO = 'logo',
  COVER = 'cover',
  AVATAR = 'avatar',
  RECEIPT = 'receipt',
}

export enum InteractionType {
  CALL = 'call',
  EMAIL = 'email',
  MEETING = 'meeting',
  VISIT = 'visit',
  OTHER = 'other',
}

/** Colonnes VARCHAR + CHECK (pas un type ENUM PostgreSQL) */
export enum DiscountType {
  PERCENT = 'percent',
  AMOUNT = 'amount',
}