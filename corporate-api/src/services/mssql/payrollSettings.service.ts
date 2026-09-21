import { PayrollSettingsModel } from "../../models/mssql/payrollSettings.model";
import type { GratificationType } from "../../models/mssql/payrollSettings.model";
import { isUniqueConstraintError } from "../../library/errors";
import { assertCompanyAdvancePercentage } from "../../library/gratificationRules";

// Fila unica (id = 1, ver migrate.ts). null = todavia no configurada.
export async function getPayrollSettings(): Promise<PayrollSettingsModel | null> {
  return PayrollSettingsModel.findByPk(1);
}

export async function savePayrollSettings(
  data: { gratificationSystem: GratificationType | null; gratificationMonthlyAdvancePercentage: number | null },
  userId?: number,
): Promise<PayrollSettingsModel | null> {
  assertCompanyAdvancePercentage(data.gratificationSystem, data.gratificationMonthlyAdvancePercentage);
  const values = {
    gratificationSystem: data.gratificationSystem,
    gratificationMonthlyAdvancePercentage: data.gratificationMonthlyAdvancePercentage,
    updatedBy: userId ?? null,
  };

  const update = async (): Promise<boolean> => {
    const existing = await PayrollSettingsModel.findByPk(1);
    if (!existing) return false;
    await existing.update(values);
    return true;
  };

  if (!(await update())) {
    try {
      await PayrollSettingsModel.create({ id: 1, ...values, createdBy: userId ?? null });
    } catch (err) {
      // Otra request creo la fila unica primero: se aplica como actualizacion.
      if (!isUniqueConstraintError(err) || !(await update())) throw err;
    }
  }
  return getPayrollSettings();
}
