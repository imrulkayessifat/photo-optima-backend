import { Router } from "express";
import {
    subscribeData
} from "../controllers/subscribe.controller";

const subscribeRouter = Router();

subscribeRouter.post("/", subscribeData);

export default subscribeRouter;