import { Router } from "express";

import {
    productCreate,
    productUpdate
} from "../controllers/product.controller";

const productRouter = Router()

productRouter.post('/create', productCreate)
productRouter.post('/update', productUpdate)

export default productRouter;