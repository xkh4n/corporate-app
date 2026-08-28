import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Employee, EmployeeCreateInput, EmployeeUpdateInput } from "../types/employee";

export const employeeService = {
  list: (params?: ListParams) => apiFetch<Paginated<Employee>>(`/employees${toQuery(params)}`),

  getById: (id: number) => apiFetch<Employee>(`/employees/${id}`),

  findByDocumentId: (documentId: string) =>
    apiFetch<Paginated<Employee>>("/employees/bydocumentId", { method: "POST", body: { documentId } }),

  findByName: (name: string) => apiFetch<Paginated<Employee>>("/employees/byname", { method: "POST", body: { name } }),

  create: (input: EmployeeCreateInput) => apiFetch<Employee>("/employees", { method: "POST", body: input }),

  update: (id: number, input: EmployeeUpdateInput) =>
    apiFetch<Employee>(`/employees/${id}`, { method: "PUT", body: input }),
};
