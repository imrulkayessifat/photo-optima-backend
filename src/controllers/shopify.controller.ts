import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

import { verifyHmac } from "../lib/utils";

const nonce = require("nonce");
const cookie = require("cookie");
const jwt = require('jsonwebtoken');

const db = new PrismaClient();

const client_id = process.env.SHOPIFY_CLIENT_ID;
const scopes = "read_orders";
const forwardingAddress = process.env.FORWARDING_ADDRESS;

export const redirectUser = (req: Request, res: Response) => {
    const shopName = req.query.shop;

    console.log("shop name : ",shopName)
    if (shopName) {

        const shopState = nonce();

        const redirectURL = forwardingAddress + "/shopify/callback";

        const installUrl =
            "https://" +
            shopName +
            "/admin/oauth/authorize?client_id=" +
            client_id +
            "&scope=" +
            scopes +
            "&state=" +
            shopState +
            "&redirect_uri=" +
            redirectURL +
            "&grant_options[]=per-user";

        res.cookie("state", shopState);
        res.redirect(installUrl);
    } else {
        return res.status(400).send('Missing "Shop Name" parameter!!');
    }
}

export const shopifyCallback = async (req: Request, res: Response): Promise<void> => {
    const { shop, hmac, code, shopState } = req.query;
    console.log("shop ",shop)
    const stateCookie = cookie.parse(req.headers.cookie).shopState;

    if (shopState !== stateCookie) {
        res.status(400).send("request origin cannot be found");
    }

    const validation = verifyHmac(req.query)

    if (!validation) {
        res.status(400).send("HMAC validation failed");
    }

    const accessTokenPayload = {
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code,
    };

    const getAccessToken = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(accessTokenPayload)
    })

    const getAccessTokenRes = await getAccessToken.json();

    const productsReq = await fetch(`https://${shop}/admin/api/2024-04/products.json`, {
        headers: {
            'X-Shopify-Access-Token': `${getAccessTokenRes.access_token}`,
        },
    })

    const productRes = await productsReq.json();

    const storeCount = await db.store.findMany({
        where: {
            name: `${shop}`
        }
    })

    if (storeCount.length === 0) {
        await db.store.create({
            data: {
                name: `${shop}`
            }
        })

        await db.product.create({
            data:{
                id:'1',
                title:'uploadcare',
                storename:`${shop}`
            }
        })
    }



    productRes.products.map((product: { images: any[]; }) => {
        product.images.map(async (image: any) => {
            const getImage = await db.image.findFirst({
                where: {
                    id: `${image.id}`
                }
            })
            if (!getImage) {
                await db.image.create({
                    data: {
                        id: `${image.id}`,
                        productId: `${image.product_id}`,
                        url: image.src
                    }
                })
            }

        })
    })

    const storeData = await db.store.findFirst({
    	where:{
    		name: `${shop}`
    	}
    })

    const token = jwt.sign(storeData, process.env.JWT_SECRET_KEY);

    console.log("token : ",token);

    if (getAccessTokenRes.scope.includes('write_products')) {
        res.redirect(`${process.env.FRONTEND_DOMAIN}/token?shop=${shop}`);
        // res.status(200).json({ data: token });
    } else {
        console.error("Access token doesn't have write_products scope:", getAccessTokenRes.access_token);
        res.status(403).send("Access token doesn't have necessary scopes");
    }
}