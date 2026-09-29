import { Router } from "express";
import * as controller from "../controllers/commRoom.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import { roomEntryRateLimiter } from "../middlewares/rateLimit";
import { validateBody } from "../middlewares/validate";

// Acceso a salas de comunicaciones (plan 016). Ningun permiso se otorga por defecto: es seguridad
// fisica. El acceso se pide y se aprueba por ticket; estas rutas administran salas, consultan y
// revocan accesos y registran los ingresos. Rutas literales ANTES de "/:id".

export const commRoomRouter = Router();
commRoomRouter.use(authenticate);

commRoomRouter.get("/settings", authorize("comm-rooms", "read"), controller.getSettings);
commRoomRouter.put("/settings", authorize("comm-rooms", "update"), validateBody(controller.settingsSchema), controller.updateSettings);
commRoomRouter.get("/", authorize("comm-rooms", "read"), controller.listRooms);
commRoomRouter.post("/", authorize("comm-rooms", "create"), validateBody(controller.roomSchema), controller.createRoom);
commRoomRouter.get("/:id", authorize("comm-rooms", "read"), controller.getRoom);
commRoomRouter.put("/:id", authorize("comm-rooms", "update"), validateBody(controller.roomSchema), controller.updateRoom);

export const commRoomAccessRouter = Router();
commRoomAccessRouter.use(authenticate);

commRoomAccessRouter.get("/reports/multi-room", authorize("comm-room-accesses", "read"), controller.multiRoomReport);
commRoomAccessRouter.get("/", authorize("comm-room-accesses", "read"), controller.listAccesses);
commRoomAccessRouter.get("/:id", authorize("comm-room-accesses", "read"), controller.getAccess);
commRoomAccessRouter.post(
  "/:id/revoke",
  authorize("comm-room-accesses", "delete"),
  validateBody(controller.revokeSchema),
  controller.revokeAccess,
);

export const commRoomEntryRouter = Router();
commRoomEntryRouter.use(authenticate);

commRoomEntryRouter.get("/", authorize("comm-room-entries", "read"), controller.listEntries);
commRoomEntryRouter.post(
  "/check-in",
  authorize("comm-room-entries", "create"),
  roomEntryRateLimiter,
  validateBody(controller.checkInSchema),
  controller.checkIn,
);
commRoomEntryRouter.post("/:id/check-out", authorize("comm-room-entries", "create"), controller.checkOut);
