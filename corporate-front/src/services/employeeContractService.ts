import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { EmployeeContract, EmployeeContractCreateInput } from "../types/payroll";

export const employeeContractService = {
  // Mas reciente primero.
  listByEmployee: (employeeId: number) =>
    apiFetch<EmployeeContract[]>(`/employee-contracts${toQuery({ employeeId })}`),

  create: (body: EmployeeContractCreateInput) =>
    apiFetch<EmployeeContract>("/employee-contracts", { method: "POST", body }),
};
