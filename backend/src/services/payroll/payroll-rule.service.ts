import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import type {
  CreatePayrollRuleDto,
  PayrollRuleListQueryDto,
  UpdatePayrollRuleDto,
} from '../../dto/payroll/payroll-rule.dto.js';
import type { PayrollRule } from '../../entities/payroll-rule.entity.js';
import { AuditAction, AuditEntityType } from '../../enums/audit.enums.js';
import { ConflictAppException, ErrorCode, ResourceNotFoundException } from '../../exceptions/index.js';
import { toPayrollRule } from '../../mapper/payroll.mapper.js';
import { PayrollRuleRepository } from '../../repository/payroll-rule.repository.js';
import type { AuthenticatedUser } from '../../security/index.js';
import { diffChanges, snapshot } from '../audit/audit-changes.js';
import { PAYROLL_RULE_AUDIT_FIELDS } from '../audit/audit-fields.js';
import { AuditService } from '../audit/audit.service.js';
import { PAYROLL_PRESETS } from './payroll-presets.js';
import { normalizeRuleShape } from './payroll-rule-shape.js';
import type { RuleShape } from './payroll-rule-shape.js';

const shapeOf = (rule: PayrollRule): RuleShape => ({
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
  effectiveFrom: rule.effectiveFrom,
  effectiveTo: rule.effectiveTo,
  isActive: rule.isActive,
});

const brackets = (dto: { brackets?: Array<{ up_to: number | null; rate: number }> | null }) =>
  dto.brackets ? dto.brackets.map((b) => ({ up_to: b.up_to, rate: b.rate })) : null;

function shapeFromCreate(dto: CreatePayrollRuleDto): RuleShape {
  return {
    code: dto.code,
    label: dto.label,
    itemType: dto.item_type,
    ruleType: dto.rule_type,
    baseKind: dto.base_kind ?? null,
    rate: dto.rate ?? null,
    fixedAmount: dto.fixed_amount ?? null,
    baseCap: dto.base_cap ?? null,
    roundingStep: dto.rounding_step ?? null,
    brackets: brackets(dto),
    familyReduction: dto.family_reduction ?? 0,
    minimumAmount: dto.minimum_amount ?? null,
    reducesTaxableIncome: dto.reduces_taxable_income ?? false,
    position: dto.position ?? 0,
    effectiveFrom: dto.effective_from,
    effectiveTo: dto.effective_to ?? null,
    isActive: dto.is_active ?? true,
  };
}

function mergeShape(current: RuleShape, dto: UpdatePayrollRuleDto): RuleShape {
  return {
    code: dto.code ?? current.code,
    label: dto.label ?? current.label,
    itemType: dto.item_type ?? current.itemType,
    ruleType: dto.rule_type ?? current.ruleType,
    baseKind: dto.base_kind !== undefined ? dto.base_kind : current.baseKind,
    rate: dto.rate !== undefined ? dto.rate : current.rate,
    fixedAmount: dto.fixed_amount !== undefined ? dto.fixed_amount : current.fixedAmount,
    baseCap: dto.base_cap !== undefined ? dto.base_cap : current.baseCap,
    roundingStep: dto.rounding_step !== undefined ? dto.rounding_step : current.roundingStep,
    brackets: dto.brackets !== undefined ? brackets(dto) : current.brackets,
    familyReduction: dto.family_reduction ?? current.familyReduction,
    minimumAmount: dto.minimum_amount !== undefined ? dto.minimum_amount : current.minimumAmount,
    reducesTaxableIncome: dto.reduces_taxable_income ?? current.reducesTaxableIncome,
    position: dto.position ?? current.position,
    effectiveFrom: dto.effective_from ?? current.effectiveFrom,
    effectiveTo: dto.effective_to !== undefined ? dto.effective_to : current.effectiveTo,
    isActive: dto.is_active ?? current.isActive,
  };
}

@Injectable()
export class PayrollRuleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rules: PayrollRuleRepository,
    private readonly audit: AuditService,
  ) {}

  async list(admin: AuthenticatedUser, query: PayrollRuleListQueryDto) {
    const result = await this.rules.list(admin.companyId, query, {
      isActive: query.is_active,
      itemType: query.item_type,
    });
    return result.map(toPayrollRule);
  }

  async create(admin: AuthenticatedUser, dto: CreatePayrollRuleDto) {
    const shape = normalizeRuleShape(shapeFromCreate(dto));

    const created = await this.dataSource.transaction((manager) =>
      this.insert(manager, admin, shape),
    );
    return toPayrollRule(created);
  }

  async update(admin: AuthenticatedUser, id: string, dto: UpdatePayrollRuleDto) {
    const { companyId } = admin;

    return this.dataSource.transaction(async (manager) => {
      const repo = this.rules.withManager(manager);
      const before = await repo.getById(companyId, id);
      const shape = normalizeRuleShape(mergeShape(shapeOf(before), dto));

      if (shape.isActive) {
        await this.assertNoOverlap(manager, admin, shape, id);
      }
      const after = await repo.changeRule(companyId, id, { ...shape });

      const diff = diffChanges(before, after, PAYROLL_RULE_AUDIT_FIELDS);
      if (diff) {
        await this.audit.record(
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.PAYROLL_RULE,
            entityId: id,
            companyId,
            userId: admin.id,
            changes: diff,
          },
          manager,
        );
      }
      return toPayrollRule(after);
    });
  }

  /** Les bulletins déjà calculés ne changent pas : leurs lignes sont figées. */
  async remove(admin: AuthenticatedUser, id: string): Promise<void> {
    const { companyId } = admin;

    await this.dataSource.transaction(async (manager) => {
      const repo = this.rules.withManager(manager);
      const rule = await repo.getById(companyId, id);
      const before = snapshot(rule, PAYROLL_RULE_AUDIT_FIELDS);
      await repo.deleteById(companyId, id);

      await this.audit.record(
        {
          action: AuditAction.DELETE,
          entityType: AuditEntityType.PAYROLL_RULE,
          entityId: id,
          companyId,
          userId: admin.id,
          changes: { before },
        },
        manager,
      );
    });
  }

  /**
   * Installe un modèle de règles, seulement sur demande explicite. Idempotent : une version déjà
   * présente, ou qui chevaucherait une règle active, est ignorée et signalée.
   */
  async applyPreset(admin: AuthenticatedUser, presetId: string) {
    const preset = PAYROLL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) throw new ResourceNotFoundException('Modèle de règles');

    return this.dataSource.transaction(async (manager) => {
      const repo = this.rules.withManager(manager);
      const created: PayrollRule[] = [];
      const skipped: Array<{ code: string; reason: string }> = [];

      for (const rule of preset.rules) {
        if (await repo.findVersion(admin.companyId, rule.code, rule.effectiveFrom)) {
          skipped.push({ code: rule.code, reason: 'already_installed' });
          continue;
        }
        const overlap = await repo.findOverlapping(
          admin.companyId,
          rule.code,
          rule.effectiveFrom,
          rule.effectiveTo,
          null,
        );
        if (overlap) {
          skipped.push({ code: rule.code, reason: 'overlaps_active_rule' });
          continue;
        }
        created.push(await this.insert(manager, admin, normalizeRuleShape(rule)));
      }
      return {
        preset: preset.id,
        label: preset.label,
        created: created.map(toPayrollRule),
        skipped,
      };
    });
  }

  // ---------- Outils internes ----------

  private async insert(
    manager: EntityManager,
    admin: AuthenticatedUser,
    shape: RuleShape,
  ): Promise<PayrollRule> {
    if (shape.isActive) await this.assertNoOverlap(manager, admin, shape, null);

    const repo = this.rules.withManager(manager);
    const inserted = await repo.insertRule(admin.companyId, { ...shape });
    const rule = await repo.getById(admin.companyId, inserted.id);

    await this.audit.record(
      {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PAYROLL_RULE,
        entityId: rule.id,
        companyId: admin.companyId,
        userId: admin.id,
        changes: { after: snapshot(rule, PAYROLL_RULE_AUDIT_FIELDS) },
      },
      manager,
    );
    return rule;
  }

  private async assertNoOverlap(
    manager: EntityManager,
    admin: AuthenticatedUser,
    shape: RuleShape,
    excludeId: string | null,
  ): Promise<void> {
    const overlap = await this.rules
      .withManager(manager)
      .findOverlapping(admin.companyId, shape.code, shape.effectiveFrom, shape.effectiveTo, excludeId);
    if (overlap) {
      throw new ConflictAppException(
        `Une règle active « ${shape.code} » est déjà en vigueur du ${overlap.effectiveFrom} au ${overlap.effectiveTo ?? 'sans limite'}. Mettez fin à celle-ci (effective_to) avant d'en créer une nouvelle version.`,
        ErrorCode.RULE_OVERLAP,
        { conflicting_rule_id: overlap.id },
      );
    }
  }
}