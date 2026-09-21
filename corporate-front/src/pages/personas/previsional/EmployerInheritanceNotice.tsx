import { Alert } from "../../../components/ui/Alert";
import type { EmployerInheritance } from "../../../types";

// CCAF y mutual se definen una sola vez para la empresa ("CCAF y Mutualidad")
// y cada colaborador las hereda al generarse su linea de nomina. Este aviso
// muestra lo que hereda hoy el colaborador seleccionado, para que quien asigna
// AFP/salud vea el resultado completo sin salir de la pantalla.
export function EmployerInheritanceNotice({ employer }: { employer: EmployerInheritance }) {
  if (!employer.ccaf && !employer.mutual) {
    return (
      <Alert tone="warning">
        La empresa aún no define su CCAF ni su mutualidad, así que este colaborador no las hereda todavía. Se
        configuran en Previsión &gt; CCAF y Mutualidad.
      </Alert>
    );
  }
  return (
    <Alert tone="info">
      Heredado de la empresa: CCAF <strong>{employer.ccaf?.name ?? "sin CCAF"}</strong> · Mutualidad{" "}
      <strong>{employer.mutual?.name ?? "sin definir"}</strong>
      {employer.mutualBranchCode !== null && <> (sucursal {employer.mutualBranchCode})</>}
    </Alert>
  );
}
