import { Router } from "express";
import * as institutionController from "../controllers/previsionalInstitution.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";

export const previsionalInstitutionRouter = Router();

previsionalInstitutionRouter.use(authenticate);
previsionalInstitutionRouter.get("/", authorize("previsional-institutions", "read"), institutionController.list);
