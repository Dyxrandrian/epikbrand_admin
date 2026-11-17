-- ============================================================
-- EpikBrand - Schéma PostgreSQL v2
-- Authentification gérée par l'application (sans Casdoor)
-- Intègre les corrections et ajouts de la section 17 du contrat
-- ============================================================

SET client_encoding = 'UTF8';

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;     -- e-mails insensibles à la casse
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- recherche floue
CREATE EXTENSION IF NOT EXISTS unaccent;   -- recherche sans accents

-- Fonction unaccent utilisable dans un index (doit être IMMUTABLE)
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS $$
    SELECT public.unaccent('public.unaccent', $1)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- ==========================================
-- 0. TYPES ENUM
-- ==========================================

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'collaborator');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');   -- + cancelled
CREATE TYPE project_status AS ENUM ('pending', 'ongoing', 'delivered');
CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE invoice_document_type AS ENUM ('quote', 'invoice', 'credit_note');         -- + avoir
CREATE TYPE invoice_payment_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled'); -- + cancelled
CREATE TYPE expense_status AS ENUM ('pending', 'paid', 'cancelled');
CREATE TYPE expense_recurrence AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');
CREATE TYPE salary_status AS ENUM ('pending', 'paid', 'cancelled');
CREATE TYPE payment_method AS ENUM ('virement', 'cheque', 'especes', 'mobile_money', 'autre');
CREATE TYPE salary_item_type AS ENUM ('earning', 'deduction');
CREATE TYPE user_token_purpose AS ENUM ('verify_email', 'reset_password', 'invitation');

-- ==========================================
-- 0.b FONCTIONS UTILITAIRES (triggers)
-- ==========================================

-- Met à jour updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Met à jour updated_at et incrémente version (verrouillage optimiste)
CREATE OR REPLACE FUNCTION bump_version() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 1. STRUCTURE CŒUR (MULTI-TENANT)
-- ==========================================

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    logo_url VARCHAR(255),
    cover_url VARCHAR(255),
    bio TEXT,
    website_url VARCHAR(255),
    address TEXT,
    phone VARCHAR(30),
    tax_info VARCHAR(100),
    nif VARCHAR(50),
    stat VARCHAR(50),
    rcs VARCHAR(50),
    -- Paramètres utilisés par la facturation, les dashboards et le stockage
    default_currency CHAR(3) NOT NULL DEFAULT 'MGA',
    default_vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.2000,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Indian/Antananarivo',
    storage_quota_bytes BIGINT NOT NULL DEFAULT 5368709120,   -- 5 Go
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    email CITEXT NOT NULL UNIQUE,
    password_hash VARCHAR(255),                     -- NULL tant que l'invitation n'est pas acceptée
    role user_role NOT NULL DEFAULT 'collaborator',
    avatar_url VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE,
    address TEXT,
    phone VARCHAR(30),
    matricule VARCHAR(50),
    job_title VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Jetons à usage unique : vérification d'e-mail, mot de passe oublié, invitation.
-- On stocke uniquement l'empreinte (hash) du jeton, jamais le jeton lui-même.
CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose user_token_purpose NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sessions : jetons de rafraîchissement avec rotation.
-- family_id regroupe tous les jetons issus d'une même connexion :
-- si un ancien jeton est rejoué, toute la famille est révoquée.
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    replaced_by UUID REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent VARCHAR(255),
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 2. CONFIGURATIONS DYNAMIQUES
-- ==========================================

CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    default_annual_days NUMERIC(5, 1),              -- quota annuel par défaut (soldes)
    UNIQUE (company_id, name)
);

CREATE TABLE article_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    UNIQUE (company_id, name),
    UNIQUE (company_id, slug)
);

CREATE TABLE article_sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    UNIQUE (company_id, slug)
);

CREATE TABLE structure_element_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    UNIQUE (company_id, slug)
);

CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    UNIQUE (company_id, name)
);

-- ==========================================
-- 3. RESSOURCES HUMAINES
-- ==========================================

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(5, 1) NOT NULL DEFAULT 0,     -- calculé par l'API
    reason TEXT,
    status request_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

-- Soldes de congés par utilisateur, type et année
CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year SMALLINT NOT NULL,
    allowance_days NUMERIC(5, 1) NOT NULL DEFAULT 0,
    UNIQUE (user_id, leave_type_id, year)
);

CREATE TABLE training_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    training_name VARCHAR(200) NOT NULL,
    description TEXT,
    status request_status NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. CRM
-- ==========================================

CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name VARCHAR(100) NOT NULL,
    contact_name VARCHAR(100),
    email VARCHAR(150),
    phone VARCHAR(30),
    address TEXT,
    archived_at TIMESTAMP WITH TIME ZONE,            -- suppression douce
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- corrigé : nullable
    type VARCHAR(50) NOT NULL,
    summary TEXT NOT NULL,
    interaction_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 5. PRODUCTION
-- ==========================================

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,   -- corrigé : plus de cascade
    title VARCHAR(150) NOT NULL,
    description TEXT,
    budget_ht NUMERIC(12, 2) DEFAULT 0.00,
    status project_status NOT NULL DEFAULT 'pending',
    deadline DATE,
    archived_at TIMESTAMP WITH TIME ZONE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,          -- sous-tâches
    title VARCHAR(150) NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'todo',
    priority task_priority NOT NULL DEFAULT 'medium',
    position NUMERIC(20, 10) NOT NULL DEFAULT 0,                         -- ordre manuel dans la colonne Kanban
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    archived_at TIMESTAMP WITH TIME ZONE,
    version INT NOT NULL DEFAULT 1,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_task_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE task_assignees (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, user_id)
);

-- Étiquettes
CREATE TABLE labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#6B7280',
    UNIQUE (company_id, name)
);

CREATE TABLE task_labels (
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

-- Commentaires et mentions
CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 6. COMPTABILITÉ & FACTURATION
-- ==========================================

-- Compteur de numérotation séquentielle : un compteur par entreprise, type et année
CREATE TABLE invoice_sequences (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type invoice_document_type NOT NULL,
    year SMALLINT NOT NULL,
    prefix VARCHAR(10) NOT NULL,                     -- ex. FAC, DEV, AVO
    last_number INT NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, type, year)
);

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,    -- corrigé : plus de cascade
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,           -- rentabilité par projet
    source_document_id UUID REFERENCES invoices(id) ON DELETE SET NULL,   -- devis d'origine ou facture corrigée par un avoir
    invoice_number VARCHAR(50) NOT NULL,
    type invoice_document_type NOT NULL DEFAULT 'invoice',
    status invoice_payment_status NOT NULL DEFAULT 'draft',
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    currency CHAR(3) NOT NULL DEFAULT 'MGA',
    vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.2000,
    notes TEXT,
    payment_terms TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    paid_at DATE,
    payment_method payment_method,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, invoice_number),
    CONSTRAINT chk_invoice_dates CHECK (due_date IS NULL OR due_date >= issue_date)
);

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(150) NOT NULL,
    supplier_name VARCHAR(150) NOT NULL,
    amount_ht NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount_ttc NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status expense_status NOT NULL DEFAULT 'pending',
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    recurrence expense_recurrence,
    parent_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,   -- dépense modèle d'une récurrence
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    paid_at DATE,
    payment_method payment_method,
    receipt_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_expense_amounts CHECK (amount_ttc = amount_ht + vat_amount),
    CONSTRAINT chk_expense_recurrence CHECK (is_recurring = FALSE OR recurrence IS NOT NULL)
);

CREATE TABLE expense_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE TABLE salaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month CHAR(7) NOT NULL,
    status salary_status NOT NULL DEFAULT 'pending',
    payment_date DATE,
    payment_method payment_method DEFAULT 'virement',
    base_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gross_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    net_salary NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_monthly_salary UNIQUE (company_id, user_id, month),
    CONSTRAINT chk_salary_month CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT chk_salary_net CHECK (net_salary = gross_salary - total_deductions)
);

CREATE TABLE salary_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    salary_id UUID NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
    type salary_item_type NOT NULL,
    code VARCHAR(50) NOT NULL,
    label VARCHAR(255) NOT NULL,
    base_amount NUMERIC(12, 2) DEFAULT 0.00,
    rate NUMERIC(5, 4) DEFAULT 0.0000,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

-- ==========================================
-- 7. CMS & NOTIFICATIONS
-- ==========================================

CREATE TABLE agency_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    section_id UUID NOT NULL REFERENCES article_sections(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES article_categories(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    archived_at TIMESTAMP WITH TIME ZONE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Historique des versions d'un article (restauration possible)
CREATE TABLE agency_article_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    article_id UUID NOT NULL REFERENCES agency_articles(id) ON DELETE CASCADE,
    version INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (article_id, version)
);

CREATE TABLE agency_structure (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type_id UUID NOT NULL REFERENCES structure_element_types(id) ON DELETE CASCADE,
    value VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50),                                 -- ex. task_assigned, invoice_overdue (préférences par événement)
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    redirect_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- purpose = 'attachment' : fichier joint à exactement un parent (tâche, projet ou article)
-- autres purposes (logo, avatar, cover, receipt) : fichier sans parent, l'URL est copiée dans la table concernée
CREATE TABLE media_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL DEFAULT 'attachment',
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    article_id UUID REFERENCES agency_articles(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_media_purpose CHECK (purpose IN ('attachment', 'logo', 'cover', 'avatar', 'receipt')),
    CONSTRAINT chk_media_parent CHECK (
        (purpose = 'attachment' AND num_nonnulls(task_id, project_id, article_id) = 1)
        OR (purpose <> 'attachment' AND num_nonnulls(task_id, project_id, article_id) = 0)
    )
);

-- ==========================================
-- 8. RACCOURCIS RAPIDES
-- ==========================================

-- Favoris / éléments épinglés
CREATE TABLE favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID NOT NULL,
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, entity_type, entity_id)
);

-- Éléments consultés récemment (mise à jour de viewed_at à chaque ouverture)
CREATE TABLE recent_views (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID NOT NULL,
    viewed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, entity_type, entity_id)
);

-- Vues enregistrées : filtres + tri + colonnes sauvegardés sous un nom
CREATE TABLE saved_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource VARCHAR(30) NOT NULL,           -- tasks, invoices, expenses, ...
    name VARCHAR(100) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    is_shared BOOLEAN NOT NULL DEFAULT FALSE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Préférences : raccourcis clavier personnalisés, préférences de notification, thème
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    shortcuts JSONB NOT NULL DEFAULT '{}',
    notification_prefs JSONB NOT NULL DEFAULT '{}',
    locale VARCHAR(10) NOT NULL DEFAULT 'fr',
    theme VARCHAR(10) NOT NULL DEFAULT 'system',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 9. JOURNAL D'AUDIT
-- ==========================================

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(30) NOT NULL,             -- create, update, delete, view, login, ...
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID,
    changes JSONB,                           -- avant / après
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 10. TRIGGERS
-- ==========================================

CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_salaries_updated BEFORE UPDATE ON salaries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_agency_structure_updated BEFORE UPDATE ON agency_structure FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_task_comments_updated BEFORE UPDATE ON task_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tables avec verrouillage optimiste (version)
CREATE TRIGGER trg_clients_version BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_projects_version BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_tasks_version BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_invoices_version BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE TRIGGER trg_articles_version BEFORE UPDATE ON agency_articles FOR EACH ROW EXECUTE FUNCTION bump_version();

-- ==========================================
-- 11. INDEX DE PERFORMANCE
-- ==========================================

-- Authentification
CREATE INDEX idx_users_company_id ON users(company_id);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, purpose);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

-- RH
CREATE INDEX idx_leave_requests_company ON leave_requests(company_id, user_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(company_id, start_date, end_date);
CREATE INDEX idx_leave_requests_status ON leave_requests(company_id, status);
CREATE INDEX idx_training_requests_company ON training_requests(company_id, user_id);

-- CRM
CREATE INDEX idx_clients_company_id ON clients(company_id) WHERE archived_at IS NULL;
CREATE INDEX idx_interactions_company_client ON interactions(company_id, client_id);
CREATE INDEX idx_interactions_date ON interactions(company_id, interaction_date DESC);

-- Production
CREATE INDEX idx_projects_company_status ON projects(company_id, status) WHERE archived_at IS NULL;
CREATE INDEX idx_projects_client ON projects(client_id);
CREATE INDEX idx_projects_deadline ON projects(company_id, deadline);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_company_status ON tasks(company_id, status) WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_dates ON tasks(company_id, end_date);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_task_assignees_user ON task_assignees(user_id);
CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at);

-- Finance
CREATE INDEX idx_invoices_company_status ON invoices(company_id, status);
CREATE INDEX idx_invoices_due_date ON invoices(company_id, due_date);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_expenses_company_status ON expenses(company_id, status);
CREATE INDEX idx_expenses_date ON expenses(company_id, expense_date);
CREATE INDEX idx_expenses_project ON expenses(project_id);
CREATE INDEX idx_expenses_due_date ON expenses(company_id, due_date);
CREATE INDEX idx_salaries_company_user ON salaries(company_id, user_id);
CREATE INDEX idx_salaries_company_month ON salaries(company_id, month);

-- CMS, notifications, fichiers
CREATE INDEX idx_articles_company_section ON agency_articles(company_id, section_id) WHERE archived_at IS NULL;
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_media_attachments_company ON media_attachments(company_id);
CREATE INDEX idx_media_task ON media_attachments(task_id);
CREATE INDEX idx_media_project ON media_attachments(project_id);
CREATE INDEX idx_media_article ON media_attachments(article_id);

-- Raccourcis
CREATE INDEX idx_recent_views_user ON recent_views(user_id, viewed_at DESC);
CREATE INDEX idx_saved_views_owner ON saved_views(owner_id, resource);

-- Audit
CREATE INDEX idx_audit_company_date ON audit_logs(company_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(company_id, entity_type, entity_id);

-- Recherche globale (floue + sans accents)
CREATE INDEX idx_search_clients ON clients USING gin (f_unaccent(company_name) gin_trgm_ops);
CREATE INDEX idx_search_projects ON projects USING gin (f_unaccent(title) gin_trgm_ops);
CREATE INDEX idx_search_tasks ON tasks USING gin (f_unaccent(title) gin_trgm_ops);
CREATE INDEX idx_search_articles ON agency_articles USING gin (f_unaccent(title) gin_trgm_ops);
CREATE INDEX idx_search_expenses ON expenses USING gin (f_unaccent(title) gin_trgm_ops);
CREATE INDEX idx_search_users ON users USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX idx_search_invoice_number ON invoices USING gin (invoice_number gin_trgm_ops);
