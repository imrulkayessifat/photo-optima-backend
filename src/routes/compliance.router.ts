import { Router } from "express";

import {
    customerRequest,
    customerErasure,
    shopErasure
} from "../controllers/compliance.controller";

const complianceRouter = Router()

complianceRouter.post('/customer-request', customerRequest)
complianceRouter.post('/customer-erasure', customerErasure)
complianceRouter.post('/shop-erasure', shopErasure)

export default complianceRouter;