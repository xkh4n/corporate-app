import { Router } from "express";
import * as countryController from "../controllers/country.controller";
import { authenticate } from "../library/middlewares/authenticate";

export const countryRouter = Router();

// Solo lectura: countries se puebla por seed (initial-data), no via API.
countryRouter.use(authenticate);
countryRouter.get("/", countryController.list);
countryRouter.get("/:id", countryController.getById);
