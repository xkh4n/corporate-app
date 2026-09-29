import { apiFetch } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type {
  CommRoom,
  CommRoomInput,
  CommRoomSettings,
  MultiRoomHolder,
  RoomAccessGrant,
  RoomAccessGrantDetail,
  RoomAccessGrantFilters,
  RoomEntry,
  RoomEntryFilters,
} from "../types/commRoom";

// Acceso a salas de comunicaciones (plan 016). El acceso se pide y se aprueba por ticket
// (serviceDeskService); aca se administran salas, accesos e ingresos.
export const commRoomService = {
  list: (params?: ListParams & { costCenterId?: number; isActive?: boolean }) =>
    apiFetch<Paginated<CommRoom>>(`/comm-rooms${toQuery(params)}`),
  getById: (id: number) => apiFetch<CommRoom>(`/comm-rooms/${id}`),
  create: (body: CommRoomInput) => apiFetch<CommRoom>("/comm-rooms", { method: "POST", body }),
  update: (id: number, body: CommRoomInput) => apiFetch<CommRoom>(`/comm-rooms/${id}`, { method: "PUT", body }),
  getSettings: () => apiFetch<CommRoomSettings>("/comm-rooms/settings"),
  updateSettings: (body: { temporaryMaxActiveDays: number }) =>
    apiFetch<CommRoomSettings>("/comm-rooms/settings", { method: "PUT", body }),

  listAccesses: (filters?: RoomAccessGrantFilters) =>
    apiFetch<Paginated<RoomAccessGrant>>(`/comm-room-accesses${toQuery(filters)}`),
  getAccess: (id: number) => apiFetch<RoomAccessGrantDetail>(`/comm-room-accesses/${id}`),
  revokeAccess: (id: number, reason: string) =>
    apiFetch<RoomAccessGrant>(`/comm-room-accesses/${id}/revoke`, { method: "POST", body: { reason } }),
  multiRoomHolders: (by: "room" | "costCenter", minPlaces = 2) =>
    apiFetch<MultiRoomHolder[]>(`/comm-room-accesses/reports/multi-room${toQuery({ by, minPlaces })}`),

  listEntries: (filters?: RoomEntryFilters) => apiFetch<Paginated<RoomEntry>>(`/comm-room-entries${toQuery(filters)}`),
  checkIn: (body: { roomId: number; documentId: string; notes?: string }) =>
    apiFetch<RoomEntry>("/comm-room-entries/check-in", { method: "POST", body }),
  checkOut: (id: number) => apiFetch<RoomEntry>(`/comm-room-entries/${id}/check-out`, { method: "POST" }),
};
