import { Router } from "express";

import {
    productCreate,
    productUpdate
} from "../controllers/product.controller";

const productRouter = Router()

productRouter.post('/product/create', productCreate)
productRouter.post('/product/update', productUpdate)

export default productRouter;