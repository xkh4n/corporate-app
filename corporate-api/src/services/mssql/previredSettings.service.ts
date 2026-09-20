import { PreviredEmployerSettingsModel } from "../../models/mssql/previredEmployerSettings.model";
import { PrevisionalInstitutionModel } from "../../models/mssql/previsionalInstitution.model";
import { getInstitutionOfTypeOrThrow } from "./previsionalInstitution.service";
import { isUniqueConstraintError } from "../../library/errors";

export interface EmployerSettingsInput {
  ccafInstitutionId: number | null;
  mutualInstitutionId: number | null;
  mutualBranchCode: number | null;
  workAccidentRate: number | null;
}

// Codigo Previred del ISL dentro de las mutualidades (Tabla 19: 00 = empresa
// sin mutual, el aporte de accidentes va al ISL).
const ISL_PREVIRED_CODE = "00";

const SETTINGS_INCLUDE = [
  { model: PrevisionalInstitutionModel, as: "ccaf" },
  { model: PrevisionalInstitutionModel, as: "mutual" },
];

// Fila unica (id = 1, ver migrate.ts). null = todavia no configurada.
export async function getEmployerSettings(): Promise<PreviredEmployerSettingsModel | null> {
  return PreviredEmployerSettingsModel.findByPk(1, { include: SETTINGS_INCLUDE });
}

export async function saveEmployerSettings(
  data: EmployerSettingsInput,
  userId?: number,
): Promise<PreviredEmployerSettingsModel | null> {
  if (data.ccafInstitutionId !== null) await getInstitutionOfTypeOrThrow(data.ccafInstitutionId, "CCAF");

  // Sucursal de pago (campo 99) la asigna la mutual privada; con ISL o sin
  // mutual no existe, asi que no se guarda un valor que Previred no espera.
  let mutualBranchCode: number | null = null;
  if (data.mutualInstitutionId !== null) {
    const mutual = await getInstitutionOfTypeOrThrow(data.mutualInstitutionId, "MUTUAL");
    if (mutual.previredCode !== ISL_PREVIRED_CODE) mutualBranchCode = data.mutualBranchCode;
  }

  const values = {
    ccafInstitutionId: data.ccafInstitutionId,
    mutualInstitutionId: data.mutualInstitutionId,
    mutualBranchCode,
    workAccidentRate: data.workAccidentRate,
    updatedBy: userId ?? null,
  };

  const update = async (): Promise<boolean> => {
    const existing = await PreviredEmployerSettingsModel.findByPk(1);
    if (!existing) return false;
    await existing.update(values);
    return true;
  };

  if (!(await update())) {
    try {
      await PreviredEmployerSettingsModel.create({ id: 1, ...values, createdBy: userId ?? null });
    } catch (err) {
      // Otra request creo la fila unica primero: se aplica como actualizacion.
      if (!isUniqueConstraintError(err) || !(await update())) throw err;
    }
  }
  return getEmployerSettings();
}
