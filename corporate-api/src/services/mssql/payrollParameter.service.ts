import { PayrollParameterModel } from "../../models/mssql/payrollParameter.model";
import type { PayrollParameterCode } from "../../models/mssql/payrollParameter.model";
import { mssql } from "../../databases/mssql/connection";
import { BadRequestError, ConflictError, isUniqueConstraintError } from "../../library/errors";

// Mas reciente primero: la primera fila es la vigente.
export async function listParameters(code: PayrollParameterCode): Promise<PayrollParameterModel[]> {
  return PayrollParameterModel.findAll({ where: { code }, order: [["validFrom", "DESC"]] });
}

function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// Registra un valor nuevo desde valid_from y cierra el vigente el dia anterior.
// Solo hacia adelante: insertar una vigencia intermedia obligaria a partir un
// tramo ya usado por calculos pasados. Repetir la fecha de la ultima vigencia
// corrige su valor (sirve para arreglar un error de tipeo).
export async function setParameter(
  data: { code: PayrollParameterCode; value: number; validFrom: string },
  userId?: number,
): Promise<PayrollParameterModel[]> {
  try {
    await mssql.transaction(async (transaction) => {
      const latest = await PayrollParameterModel.findOne({
        where: { code: data.code },
        order: [["validFrom", "DESC"]],
        transaction,
      });

      if (latest && data.validFrom < latest.validFrom) {
        throw new BadRequestError(
          `Solo se puede registrar una vigencia desde ${latest.validFrom} o posterior (la ultima registrada)`,
        );
      }

      if (latest && data.validFrom === latest.validFrom) {
        await latest.update({ value: data.value, updatedBy: userId ?? null }, { transaction });
        return;
      }

      if (latest) {
        await latest.update({ validTo: dayBefore(data.validFrom), updatedBy: userId ?? null }, { transaction });
      }
      await PayrollParameterModel.create(
        { code: data.code, value: data.value, validFrom: data.validFrom, validTo: null, createdBy: userId ?? null, updatedBy: userId ?? null },
        { transaction },
      );
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new ConflictError("Otra request registro esa vigencia primero");
    throw err;
  }
  return listParameters(data.code);
}
