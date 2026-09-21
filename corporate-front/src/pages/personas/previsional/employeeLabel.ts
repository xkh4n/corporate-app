import type { Employee } from "../../../types";

// "CODIGO - NOMBRE APELLIDO", en mayusculas como el resto del alta de
// colaboradores.
export function employeeLabel(employee: Employee): string {
  const { firstName, lastName, maternalLastName } = employee.person;
  return `${employee.employeeCode} - ${[firstName, lastName, maternalLastName].filter(Boolean).join(" ")}`.toUpperCase();
}
