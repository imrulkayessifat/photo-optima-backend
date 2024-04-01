import { Router } from "express";

import {
    getAllProducts,
    getProductById,
    storeProductData,
    deleteProductById
} from "../controllers/product.controller";

const productRouter = Router();

productRouter.get("/", getAllProducts);
productRouter.get("/:id", getProductById);
productRouter.post("/", storeProductData);
productRouter.delete("/:id", deleteProductById);

export default productRouter;