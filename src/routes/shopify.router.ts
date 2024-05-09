import { Router } from "express";

import {
    redirectUser,
    shopifyCallback
} from "../controllers/shopify.controller";

const shopifyRouter = Router()

shopifyRouter.get('/', redirectUser)
shopifyRouter.get('/callback', shopifyCallback)

export default shopifyRouter;