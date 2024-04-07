import { Router } from "express";

import { compressData } from "../controllers/compress.controller";

const compressRouter = Router();

compressRouter.post("/", compressData);

export default compressRouter;