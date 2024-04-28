import { Router } from "express";
import {
    makePayment
} from "../controllers/payment.controller";

const paymentRouter = Router();

paymentRouter.post("/", makePayment);

export default paymentRouter;