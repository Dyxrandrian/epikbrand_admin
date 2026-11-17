export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  COLLABORATOR = 'collaborator',
}

export enum RequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
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

export enum InvoiceDocumentType {
  QUOTE = 'quote',
  INVOICE = 'invoice',
}

export enum InvoicePaymentStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  PAID = 'paid',
  OVERDUE = 'overdue',
}

export enum ExpenseStatus {
  PENDING = 'pending',
  PAID = 'paid',
  CANCELLED = 'cancelled',
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