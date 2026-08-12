import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { Person, PersonCreateInput, PersonUpdateInput } from "../types/person";

export const personService = {
  list: (params?: ListParams) => apiFetch<Paginated<Person>>(`/persons${toQuery(params)}`),

  getById: (id: number) => apiFetch<Person>(`/persons/${id}`),

  findByDocumentId: (documentId: string) =>
    apiFetch<Paginated<Person>>("/persons/bydocumentId", { method: "POST", body: { documentId } }),

  findByName: (name: string) => apiFetch<Paginated<Person>>("/persons/byname", { method: "POST", body: { name } }),

  create: (input: PersonCreateInput) => apiFetch<Person>("/persons", { method: "POST", body: input }),

  update: (id: number, input: PersonUpdateInput) =>
    apiFetch<Person>(`/persons/${id}`, { method: "PUT", body: input }),

  deactivate: (id: number) => apiFetch<void>(`/persons/${id}`, { method: "DELETE" }),
};
